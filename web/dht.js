// web/dht.js
import CryptoJS from 'https://cdn.jsdelivr.net/npm/crypto-js@4.2.0/+esm';
import Peer from 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/+esm';
import { db } from './firebase.js'; // Import from firebase.js
import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js';

export class DHT {
  constructor(keypair, isNode = false, wasmModule) {
    this.peers = new Map(); // Map of peerId -> { connected: boolean, conn: PeerJS.DataConnection }
    this.channels = new Map(); // Map of channelId -> Set of peerIds
    this.knownObjects = new Map(); // Map of ipHash -> { metadata, chunks: [chunkHash] }
    this.chunkToPeerMap = new Map(); // Map of chunkHash -> Set of peerIds
    this.pendingRequests = new Map(); // Map of requestId -> { resolve, reject, hash }
    this.db = null; // IndexedDB instance
    this.keypair = keypair; // Uint8Array keypair
    this.activeNodes = new Set(); // Set of active peerIds (both nodes and regular peers)
    this.nodes = new Set(); // Set of known node peerIds
    this.offlineQueue = []; // Array of offline operations
    this.isNode = isNode; // Is this instance a node?
    this.peerId = null; // This node's peerId
    this.peer = null; // PeerJS instance
    this.connectionAttempts = new Map(); // Map of peerId -> number of connection attempts
    this.maxConnectionAttempts = 3; // Maximum number of connection attempts per peer
    this.connectionRetryDelay = 5000; // Delay between connection attempts (ms)
    this.wasmModule = wasmModule; // Wasm module instance
    this.averageLatency = 0; // Average latency to peers (ms)

    // Initialize known nodes
    this.initializeKnownNodes();
  }

  // Fetch nodes from Firestore and periodically refresh
  async initializeKnownNodes() {
    const fetchNodes = async () => {
      try {
        const nodesSnapshot = await getDocs(collection(db, 'nodes'));
        this.nodes.clear();
        if (!nodesSnapshot.empty) {
          nodesSnapshot.forEach(doc => {
            const nodePeerId = `node-${doc.id}`;
            this.nodes.add(nodePeerId);
          });
        } else {
          console.warn('No nodes found in Firestore. Using empty node list.');
        }
        console.log('Fetched nodes:', Array.from(this.nodes));
      } catch (error) {
        console.error('Failed to fetch nodes from Firestore:', error);
        this.nodes.clear();
        console.warn('No nodes available. Peer discovery will be limited to regular peers.');
      }
    };

    // Initial fetch
    await fetchNodes();

    // Periodically refresh the node list (every 5 minutes)
    setInterval(fetchNodes, 5 * 60 * 1000);
  }

  // Measure average latency to peers
  async measureLatency() {
    const latencies = [];
    const peersToTest = Array.from(this.activeNodes).slice(0, 5); // Test up to 5 peers
    for (const peerId of peersToTest) {
      const peer = this.peers.get(peerId);
      if (peer && peer.connected && peer.conn) {
        const start = Date.now();
        await new Promise(resolve => {
          const requestId = `${peerId}-ping-${Date.now()}`;
          peer.conn.send({ type: 'ping', requestId });
          this.pendingRequests.set(requestId, { resolve });
          setTimeout(() => {
            if (this.pendingRequests.has(requestId)) {
              this.pendingRequests.delete(requestId);
              resolve();
            }
          }, 2000);
        });
        const latency = Date.now() - start;
        latencies.push(latency);
      }
    }
    this.averageLatency = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
    console.log(`Average latency: ${this.averageLatency} ms`);
  }

  // Initialize IndexedDB
  async initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('dcrypt_db', 3);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('store')) {
          db.createObjectStore('store', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('transactions')) {
          db.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('offlineQueue')) {
          db.createObjectStore('offlineQueue', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('chunkCache')) {
          db.createObjectStore('chunkCache', { keyPath: 'id' });
        }
      };
      request.onsuccess = () => {
        this.db = request.result;
        this.loadIdentity();
        this.loadOfflineQueue();
        this.loadTransactions();
        console.log('IndexedDB initialized successfully');
        resolve();
      };
      request.onerror = (error) => {
        console.error('Failed to initialize IndexedDB:', error.target.error);
        reject(new Error(`Failed to initialize IndexedDB: ${error.target.error.message}`));
      };
    });
  }

  // Sync user data with IndexedDB and peers
  async syncUserData() {
    if (!this.db) throw new Error('IndexedDB not initialized');
    try {
      await this.dbPut('store', { id: 'dcrypt_identity', value: this.uint8ArrayToHex(this.keypair) });
      await this.updateBalance();
      if (this.activeNodes.size > 0) {
        await this.processOfflineQueue();
      }
      const userData = {
        type: 'userData',
        peerId: this.peerId,
        keypair: this.uint8ArrayToHex(this.keypair),
        balance: await this.getBalance(this.keypair),
        timestamp: Date.now()
      };
      this.broadcast(userData);
      console.log('User data synced successfully');
    } catch (error) {
      console.error('Sync failed:', error);
      throw error;
    }
  }

  // Save user data to IndexedDB
  async saveUserData() {
    if (!this.db) throw new Error('IndexedDB not initialized');
    try {
      await this.dbPut('store', { id: 'dcrypt_identity', value: this.uint8ArrayToHex(this.keypair) });
      await this.updateBalance();
      console.log('User data saved to IndexedDB');
    } catch (error) {
      console.error('Save failed:', error);
      throw error;
    }
  }

  // Initialize PeerJS swarm
  async initSwarm() {
    try {
      const basePeerId = this.uint8ArrayToHex(this.keypair.slice(0, 16));
      this.peerId = this.isNode ? `node-${basePeerId}` : basePeerId;
      console.log('Initializing PeerJS with Peer ID:', this.peerId);

      this.peer = new Peer(this.peerId, {
        host: '0.peerjs.com',
        port: 443,
        path: '/',
        secure: true,
        debug: 2
      });

      return new Promise((resolve, reject) => {
        this.peer.on('open', id => {
          console.log(`PeerJS connection opened with ID: ${id}`);
          this.activeNodes.add(this.peerId);

          this.peer.on('connection', conn => {
            this.handleConnection(conn);
          });

          this.peer.on('error', err => {
            console.error('PeerJS error:', err.type, err.message);
            if (err.type === 'peer-unavailable') {
              const peerId = err.message.match(/Peer (.+) is unavailable/)?.[1];
              if (peerId) {
                this.handlePeerDisconnect(peerId);
              }
            }
          });

          this.peer.on('disconnected', () => {
            console.log('PeerJS disconnected. Attempting to reconnect...');
            this.peer.reconnect();
          });

          setInterval(() => this.discoverPeers(), 5000);
          setInterval(() => this.measureLatency(), 60000); // Measure latency every minute
          resolve();
        });

        this.peer.on('error', err => {
          console.error('Failed to initialize PeerJS:', err);
          reject(err);
        });
      });
    } catch (error) {
      console.error('initSwarm failed:', error);
      throw error;
    }
  }

  // Discover and connect to peers
  discoverPeers() {
    console.log('Discovering peers...');
    const knownPeerIds = [
      ...Array.from(this.nodes)
    ].filter(id => id !== this.peerId);

    if (knownPeerIds.length === 0) {
      console.warn('No known peers to connect to. Waiting for nodes to be discovered.');
      return;
    }

    knownPeerIds.forEach(peerId => {
      if (!this.peers.has(peerId)) {
        this.peers.set(peerId, { connected: false, conn: null });
        console.log('Discovered peer:', peerId);
        this.connectToPeer(peerId);
      }
    });

    this.peers.forEach((peer, peerId) => {
      if (!peer.connected && this.connectionAttempts.get(peerId) >= this.maxConnectionAttempts) {
        console.log(`Removing unreachable peer: ${peerId}`);
        this.peers.delete(peerId);
        this.connectionAttempts.delete(peerId);
        this.activeNodes.delete(peerId);
      }
    });
  }

  // Connect to a peer
  connectToPeer(peerId) {
    if (this.peers.get(peerId)?.connected) return;
    const attempts = this.connectionAttempts.get(peerId) || 0;
    if (attempts >= this.maxConnectionAttempts) return;

    console.log(`Attempting to connect to peer: ${peerId} (Attempt ${attempts + 1}/${this.maxConnectionAttempts})`);
    const conn = this.peer.connect(peerId, { reliable: true });

    conn.on('open', () => {
      console.log(`Connected to peer: ${peerId}`);
      this.peers.set(peerId, { connected: true, conn });
      this.activeNodes.add(peerId);
      this.connectionAttempts.delete(peerId);
      conn.send({ type: 'handshake', peerId: this.peerId });
    });

    conn.on('data', data => {
      this.handlePeerData(data, peerId);
    });

    conn.on('close', () => {
      console.log(`Connection closed with peer: ${peerId}`);
      this.handlePeerDisconnect(peerId);
    });

    conn.on('error', err => {
      console.warn(`Connection error with peer ${peerId}: ${err.message}`);
      this.handlePeerDisconnect(peerId);
    });

    this.connectionAttempts.set(peerId, attempts + 1);
  }

  // Handle incoming connections
  handleConnection(conn) {
    const peerId = conn.peer;
    console.log(`Incoming connection from peer: ${peerId}`);
    this.peers.set(peerId, { connected: true, conn });
    this.activeNodes.add(peerId);

    conn.on('data', data => {
      this.handlePeerData(data, peerId);
    });

    conn.on('close', () => {
      console.log(`Connection closed with peer: ${peerId}`);
      this.handlePeerDisconnect(peerId);
    });

    conn.on('error', err => {
      console.error(`Connection error with peer ${peerId}:`, err);
      this.handlePeerDisconnect(peerId);
    });
  }

  // Handle peer disconnection
  handlePeerDisconnect(peerId) {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.connected = false;
      peer.conn = null;
      this.activeNodes.delete(peerId);
      console.log(`Peer disconnected: ${peerId}. Will attempt to reconnect on next discovery.`);
    }
  }

  // Handle data received from peers
  handlePeerData(data, peerId) {
    console.log(`Received data from peer ${peerId}:`, data);
    switch (data.type) {
      case 'handshake':
        console.log(`Handshake received from peer: ${peerId}`);
        this.activeNodes.add(peerId);
        break;
      case 'chunk':
        this.chunkToPeerMap.set(data.chunkHash, new Set([...(this.chunkToPeerMap.get(data.chunkHash) || []), peerId]));
        console.log(`Updated chunkToPeerMap for chunk ${data.chunkHash} with peer ${peerId}`);
        break;
      case 'ip':
        this.knownObjects.set(data.ipHash, { metadata: data.metadata, chunks: data.chunkHashes });
        this.dbPut('store', { id: data.ipHash, value: JSON.stringify({ metadata: data.metadata, chunks: data.chunkHashes }) });
        console.log(`Received IP ${data.ipHash} from peer ${peerId}`);
        break;
      case 'chunkRequest':
        this.handleChunkRequest(data, peerId);
        break;
      case 'chunkResponse':
        this.handleChunkResponse(data);
        break;
      case 'userData':
        console.log(`Received user data from peer ${peerId}:`, data);
        break;
      case 'storeChunk':
        this.storeChunkFromPeer(data.chunkHash, data.chunkData, peerId);
        break;
      case 'ping':
        const peer = this.peers.get(peerId);
        if (peer && peer.connected && peer.conn) {
          peer.conn.send({ type: 'pong', requestId: data.requestId });
        }
        break;
      case 'pong':
        const request = this.pendingRequests.get(data.requestId);
        if (request) {
          request.resolve();
          this.pendingRequests.delete(data.requestId);
        }
        break;
      case 'commission':
        console.log(`Received commission of ${data.amount}. New balance: ${data.newBalance}`);
        break;
      default:
        console.warn(`Unknown data type received from peer ${peerId}:`, data.type);
    }
  }

  // Store a chunk received from another peer
  async storeChunkFromPeer(chunkHash, chunkData, peerId) {
    try {
      await this.dbPut('chunkCache', { id: chunkHash, value: chunkData });
      let peerSet = this.chunkToPeerMap.get(chunkHash) || new Set();
      peerSet.add(this.peerId);
      this.chunkToPeerMap.set(chunkHash, peerSet);
      console.log(`Stored chunk ${chunkHash} from peer ${peerId}`);
    } catch (error) {
      console.error(`Failed to store chunk ${chunkHash} from peer ${peerId}:`, error);
    }
  }

  // Publish a chunk to the DHT
  async publishChunk(chunkHash, chunkData, chunkIndex, totalChunks) {
    if (!this.db) throw new Error('IndexedDB not initialized');
    try {
      console.log('publishChunk: chunkHash=', chunkHash, 'chunkData=', chunkData);
      if (!chunkHash || typeof chunkHash !== 'string' || chunkHash.trim() === '') {
        throw new Error('Invalid chunk hash');
      }
      await this.dbPut('chunkCache', { id: chunkHash, value: chunkData });

      let peerSet = this.chunkToPeerMap.get(chunkHash) || new Set();
      peerSet.add(this.peerId);
      this.chunkToPeerMap.set(chunkHash, peerSet);

      if (this.activeNodes.size > 0) {
        const activeNodeList = Array.from(this.activeNodes).filter(peerId => peerId.startsWith('node-'));
        if (activeNodeList.length > 0) {
          const nodeIndex = chunkIndex % activeNodeList.length;
          const targetNode = activeNodeList[nodeIndex];
          const nodePeer = this.peers.get(targetNode);
          if (nodePeer && nodePeer.connected && nodePeer.conn) {
            nodePeer.conn.send({ type: 'storeChunk', chunkHash, chunkData, peerId: this.peerId });
            peerSet.add(targetNode);
            this.chunkToPeerMap.set(chunkHash, peerSet);
            console.log(`Sent chunk ${chunkHash} to node ${targetNode}`);
          }
        }

        const regularPeers = Array.from(this.activeNodes).filter(peerId => !peerId.startsWith('node-') && peerId !== this.peerId);
        if (regularPeers.length > 0) {
          const randomPeerId = regularPeers[Math.floor(Math.random() * regularPeers.length)];
          const randomPeer = this.peers.get(randomPeerId);
          if (randomPeer && randomPeer.connected && randomPeer.conn) {
            randomPeer.conn.send({ type: 'storeChunk', chunkHash, chunkData, peerId: this.peerId });
            peerSet.add(randomPeerId);
            this.chunkToPeerMap.set(chunkHash, peerSet);
            console.log(`Sent chunk ${chunkHash} to random peer ${randomPeerId}`);
          }
        }
      } else {
        await this.queueOfflineOperation({ type: 'publishChunk', chunkHash, chunkData, chunkIndex, totalChunks });
      }

      this.broadcastChunk(chunkHash);
    } catch (error) {
      console.error('publishChunk failed:', error);
      throw error;
    }
  }

  // Broadcast chunk availability to peers
  broadcastChunk(chunkHash) {
    const message = { type: 'chunk', chunkHash, peerId: this.peerId };
    this.broadcast(message);
    console.log(`Broadcasted chunk ${chunkHash} to ${this.activeNodes.size} peers`);
  }

  // Publish an IP (metadata + content) to the DHT
  async publishIP(metadata, content, fileType) {
    if (!this.db) throw new Error('IndexedDB not initialized');
    if (!this.wasmModule) throw new Error('Wasm module not initialized');
    try {
      // Create IntellectualProperty object using Wasm
      const tags = new Array();
      metadata.tags.forEach(tag => tags.push(tag));
      const ip = this.wasmModule.create_intellectual_property(
        new Uint8Array(content),
        metadata.content_type,
        tags,
        metadata.isPremium,
        metadata.isPremium ? 30 : 5,
        this.keypair,
        fileType
      );

      // Compute IP hash
      const contentBytes = this.wasmModule.get_ip_content(ip);
      const ipHashBytes = this.wasmModule.compute_full_hash(contentBytes);
      const ipHash = this.uint8ArrayToHex(ipHashBytes);

      // Chunk and encrypt the content
      const activeNodeList = Array.from(this.activeNodes).filter(peerId => peerId.startsWith('node-'));
      const minChunks = activeNodeList.length > 0 ? activeNodeList.length : 1;
      const chunks = this.wasmModule.chunk_encrypt(ip, Array.from(this.keypair), minChunks);

      // Extract chunk hashes
      const chunkHashes = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks.get(i);
        const chunkHashBytes = this.wasmModule.get_chunk_hash(chunk);
        const chunkHash = this.uint8ArrayToHex(chunkHashBytes);
        chunkHashes.push(chunkHash);
      }

      // Update metadata with chunk count
      const updatedMetadata = {
        ...metadata,
        chunk_count: chunks.length
      };

      // Store IP object
      const ipObject = { metadata: updatedMetadata, chunks: chunkHashes };
      this.knownObjects.set(ipHash, ipObject);
      await this.dbPut('store', { id: ipHash, value: JSON.stringify(ipObject) });

      // Publish each chunk
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks.get(i);
        const chunkHash = chunkHashes[i];
        await this.publishChunk(chunkHash, chunk, i, chunks.length);
      }

      if (this.activeNodes.size > 0) {
        this.broadcastIP(ipHash, updatedMetadata, chunkHashes);
      } else {
        await this.queueOfflineOperation({ type: 'publishIP', ipHash, metadata: updatedMetadata, chunkHashes });
      }

      return ipHash;
    } catch (error) {
      console.error('publishIP failed:', error);
      throw error;
    }
  }

  // Broadcast IP to peers
  broadcastIP(ipHash, metadata, chunkHashes) {
    const message = { type: 'ip', ipHash, metadata, chunkHashes, peerId: this.peerId };
    this.broadcast(message);
    console.log(`Broadcasted IP ${ipHash} to ${this.activeNodes.size} peers`);
  }

  // Request data from the DHT (reconstructs the full content)
  async requestData(ipHash) {
    if (!this.db) throw new Error('IndexedDB not initialized');
    if (!this.wasmModule) throw new Error('Wasm module not initialized');
    try {
      if (!ipHash || typeof ipHash !== 'string') throw new Error('Invalid IP hash');

      // Get the IP object
      const ipObject = this.knownObjects.get(ipHash);
      if (!ipObject) throw new Error('IP not found');

      // Fetch all chunks
      const chunks = [];
      for (const chunkHash of ipObject.chunks) {
        // Check local cache first
        const cachedChunk = await this.dbGet('chunkCache', chunkHash);
        if (cachedChunk && cachedChunk.value) {
          chunks.push({ chunk: cachedChunk.value, hash: chunkHash });
          continue;
        }

        // Find peers that have the chunk
        const peersWithChunk = this.chunkToPeerMap.get(chunkHash);
        if (!peersWithChunk || peersWithChunk.size === 0) {
          throw new Error(`No peers found with chunk ${chunkHash}`);
        }

        // Prioritize nodes
        const nodePeers = Array.from(peersWithChunk).filter(peerId => peerId.startsWith('node-'));
        const regularPeers = Array.from(peersWithChunk).filter(peerId => !peerId.startsWith('node-'));

        let chunkFetched = false;
        let lastError = null;
        for (const peerId of [...nodePeers, ...regularPeers]) {
          if (this.activeNodes.has(peerId)) {
            try {
              const chunk = await this.fetchChunkFromPeer(peerId, chunkHash);
              await this.dbPut('chunkCache', { id: chunkHash, value: chunk });
              chunks.push({ chunk, hash: chunkHash });
              chunkFetched = true;
              break;
            } catch (error) {
              lastError = error;
              console.error(`Failed to fetch chunk ${chunkHash} from peer ${peerId}:`, error);
              continue;
            }
          }
        }

        if (!chunkFetched) {
          throw lastError || new Error(`No available peer for chunk ${chunkHash}`);
        }
      }

      // Sort chunks by index and decrypt
      const sortedChunks = chunks.sort((a, b) => {
        const indexA = this.wasmModule.get_chunk_index(a.chunk);
        const indexB = this.wasmModule.get_chunk_index(b.chunk);
        return indexA - indexB;
      });

      const decryptedData = [];
      for (const { chunk } of sortedChunks) {
        const decryptedChunk = this.wasmModule.decrypt_chunk(chunk, Array.from(this.keypair));
        decryptedData.push(decryptedChunk);
      }

      // Concatenate the decrypted data
      const fullData = new Uint8Array(decryptedData.reduce((acc, chunk) => acc + chunk.length, 0));
      let offset = 0;
      for (const chunk of decryptedData) {
        fullData.set(chunk, offset);
        offset += chunk.length;
      }

      // Get the file type (same for all chunks)
      const fileType = this.wasmModule.get_chunk_file_type(sortedChunks[0].chunk);
      return { data: fullData, fileType };
    } catch (error) {
      console.error('requestData failed:', error);
      throw error;
    }
  }

  // Fetch a chunk from a specific peer
  async fetchChunkFromPeer(peerId, hash) {
    const peer = this.peers.get(peerId);
    if (!peer || !peer.connected || !peer.conn) {
      throw new Error(`Peer ${peerId} is not connected`);
    }

    const requestId = `${peerId}-${hash}-${Date.now()}`;
    const message = { type: 'chunkRequest', requestId, chunkHash: hash, peerId: this.peerId };
    peer.conn.send(message);

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject, hash });
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error(`Request for chunk ${hash} from peer ${peerId} timed out`));
        }
      }, 10000);
    });
  }

  // Handle a chunk request from a peer
  handleChunkRequest(data, peerId) {
    const { requestId, chunkHash } = data;
    this.dbGet('chunkCache', chunkHash).then(chunk => {
      if (chunk && chunk.value) {
        const response = { type: 'chunkResponse', requestId, chunkHash, chunkData: chunk.value, peerId: this.peerId };
        const peer = this.peers.get(peerId);
        if (peer && peer.connected && peer.conn) {
          peer.conn.send(response);
          console.log(`Sent chunk ${chunkHash} to peer ${peerId}`);
        }
      } else {
        console.warn(`Chunk ${chunkHash} not found for peer ${peerId}`);
      }
    }).catch(error => {
      console.error(`Failed to retrieve chunk ${chunkHash} for peer ${peerId}:`, error);
    });
  }

  // Handle a chunk response from a peer
  handleChunkResponse(data) {
    const { requestId, chunkHash, chunkData } = data;
    const request = this.pendingRequests.get(requestId);
    if (request) {
      if (request.hash === chunkHash) {
        request.resolve(chunkData);
      } else {
        request.reject(new Error(`Received chunk hash ${chunkHash} does not match requested hash ${request.hash}`));
      }
      this.pendingRequests.delete(requestId);
    }
  }

  // Distribute commission to nodes
  async distributeCommission(commission) {
    const activeNodeList = Array.from(this.activeNodes).filter(peerId => peerId.startsWith('node-'));
    if (activeNodeList.length === 0) {
      console.log('No active nodes to distribute commission to.');
      return;
    }

    const commissionPerNode = commission / activeNodeList.length;
    console.log(`Distributing commission of ${commission} to ${activeNodeList.length} nodes (${commissionPerNode} per node)`);

    for (const nodePeerId of activeNodeList) {
      const nodeKeypair = this.hexToUint8Array(nodePeerId.replace('node-', ''));
      const currentBalance = await this.getBalance(nodeKeypair);
      const newBalance = currentBalance + commissionPerNode;
      await this.putBalance(nodeKeypair, newBalance);
      console.log(`Awarded ${commissionPerNode} to node ${nodePeerId}. New balance: ${newBalance}`);

      const nodePeer = this.peers.get(nodePeerId);
      if (nodePeer && nodePeer.connected && nodePeer.conn) {
        nodePeer.conn.send({
          type: 'commission',
          amount: commissionPerNode,
          newBalance,
          peerId: this.peerId
        });
      }
    }
  }

  // Get balance for a keypair
  async getBalance(keypair) {
    if (!this.db) throw new Error('IndexedDB not initialized');
    const balance = await this.dbGet('store', 'balance_' + this.uint8ArrayToHex(keypair));
    return balance && balance.value ? parseFloat(balance.value) : 0;
  }

  // Set balance for a keypair
  async putBalance(keypair, amount) {
    if (!this.db) throw new Error('IndexedDB not initialized');
    if (typeof amount !== 'number' || amount < 0) {
      throw new Error('Invalid balance amount');
    }
    await this.dbPut('store', { id: 'balance_' + this.uint8ArrayToHex(keypair), value: amount.toString() });
    if (this.activeNodes.size > 0) {
      this.broadcast({
        type: 'userData',
        peerId: this.peerId,
        keypair: this.uint8ArrayToHex(this.keypair),
        balance: amount,
        timestamp: Date.now()
      });
    }
  }

  // Update balance in IndexedDB
  async updateBalance() {
    if (!this.db) throw new Error('IndexedDB not initialized');
    const balance = await this.getBalance(this.keypair);
    await this.putBalance(this.keypair, balance);
  }

  // Queue an operation for offline processing
  async queueOfflineOperation(operation) {
    if (!this.db) throw new Error('IndexedDB not initialized');
    this.offlineQueue.push(operation);
    await this.dbAdd('offlineQueue', { id: Date.now().toString(), value: operation });
    console.log('Queued offline operation:', operation);
  }

  // Process offline queue when online
  async processOfflineQueue() {
    if (this.offlineQueue.length === 0) return;
    console.log('Processing offline queue...');
    const queue = [...this.offlineQueue];
    this.offlineQueue = [];

    const tx = this.db.transaction('offlineQueue', 'readwrite');
    const store = tx.objectStore('offlineQueue');
    await new Promise(resolve => {
      store.clear().onsuccess = resolve;
    });

    for (const operation of queue) {
      try {
        switch (operation.type) {
          case 'publishChunk':
            await this.publishChunk(operation.chunkHash, operation.chunkData, operation.chunkIndex, operation.totalChunks);
            break;
          case 'publishIP':
            await this.broadcastIP(operation.ipHash, operation.metadata, operation.chunkHashes);
            break;
          default:
            console.warn('Unknown offline operation type:', operation.type);
        }
      } catch (error) {
        console.error(`Failed to process offline operation ${operation.type}:`, error);
        this.offlineQueue.push(operation);
        await this.dbAdd('offlineQueue', { id: Date.now().toString(), value: operation });
      }
    }
  }

  // Load identity from IndexedDB
  loadIdentity() {
    if (!this.db) return;
    this.dbGet('store', 'dcrypt_identity').then(hex => {
      if (hex && hex.value && typeof hex.value === 'string') {
        this.keypair = this.hexToUint8Array(hex.value);
        console.log('Loaded identity from IndexedDB');
      }
    }).catch(error => {
      console.error('Failed to load identity:', error);
    });
  }

  // Load offline queue from IndexedDB
  loadOfflineQueue() {
    if (!this.db) return;
    this.dbGetAll('offlineQueue').then(queue => {
      this.offlineQueue = queue.map(q => q.value);
      console.log('Loaded offline queue:', this.offlineQueue);
    }).catch(error => {
      console.error('Failed to load offline queue:', error);
    });
  }

  // Load transactions from IndexedDB
  loadTransactions() {
    if (!this.db) return;
    this.dbGetAll('transactions').then(transactions => {
      console.log('Loaded transactions:', transactions);
    }).catch(error => {
      console.error('Failed to load transactions:', error);
    });
  }

  // IndexedDB operations
  async dbPut(storeName, value) {
    if (!this.db) throw new Error('IndexedDB not initialized');
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(value);
      req.onsuccess = () => resolve();
      req.onerror = (e) => reject(new Error(`DB put failed: ${e.target.error.message}`));
    });
  }

  async dbAdd(storeName, value) {
    if (!this.db) throw new Error('IndexedDB not initialized');
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.add(value);
      req.onsuccess = () => resolve();
      req.onerror = (e) => reject(new Error(`DB add failed: ${e.target.error.message}`));
    });
  }

  async dbGet(storeName, key) {
    if (!this.db) throw new Error('IndexedDB not initialized');
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(new Error(`DB get failed: ${e.target.error.message}`));
    });
  }

  async dbGetAll(storeName) {
    if (!this.db) throw new Error('IndexedDB not initialized');
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(new Error(`DB getAll failed: ${e.target.error.message}`));
    });
  }

  // Convert Uint8Array to hex string
  uint8ArrayToHex(arr) {
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Convert hex string to Uint8Array
  hexToUint8Array(hex) {
    if (!hex || typeof hex !== 'string') return new Uint8Array(0);
    const matches = hex.match(/.{1,2}/g);
    return matches ? new Uint8Array(matches.map(byte => parseInt(byte, 16))) : new Uint8Array(0);
  }

  // Broadcast a message to all connected peers
  broadcast(message) {
    this.peers.forEach((peer, peerId) => {
      if (peer.connected && peer.conn) {
        peer.conn.send(message);
      }
    });
  }
}