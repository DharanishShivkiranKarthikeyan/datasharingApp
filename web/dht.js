// web/dht.js
import CryptoJS from 'https://cdn.jsdelivr.net/npm/crypto-js@4.2.0/+esm';
import Peer from 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/+esm';
import { db } from './firebase.js';
import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js';
import {
  createIntellectualProperty,
  getIpContent,
  computeFullHash,
  chunkEncrypt,
  getChunkHash,
  getIpMetadata,
  getChunkIndex,
  decryptChunk,
  getChunkFileType,
} from './utils.js';

export class DHT {
  constructor(keypair, isNode = false) {
    this.peers = new Map();
    this.channels = new Map();
    this.knownObjects = new Map();
    this.chunkToPeerMap = new Map();
    this.pendingRequests = new Map();
    this.db = null;
    this.keypair = keypair; // Now a string (e.g., Firebase UID)
    this.activeNodes = new Set();
    this.nodes = new Set();
    this.offlineQueue = [];
    this.isNode = isNode;
    this.peerId = null;
    this.peer = null;
    this.connectionAttempts = new Map();
    this.maxConnectionAttempts = 3;
    this.connectionRetryDelay = 5000;
    this.averageLatency = 0;

    console.log('DHT initialized with keypair:', keypair);
    console.log('Keypair length:', keypair.length);
    console.log('Keypair suitability:', keypair.length <= 40 ? 'Good' : 'Warning (large keypair)');

    this.initializeKnownNodes();
  }

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

    await fetchNodes();
    setInterval(fetchNodes, 5 * 60 * 1000);
  }

  async measureLatency() {
    const latencies = [];
    const peersToTest = Array.from(this.activeNodes).slice(0, 5);
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

  async initDB() {
    return new Promise((resolve, reject) => {
      const TARGET_VERSION = 5; // Match index.js
      console.log('Starting DHT database initialization...');
      const request = indexedDB.open('dcrypt_db', TARGET_VERSION);
      let db;

      request.onupgradeneeded = (event) => {
        console.log('Upgrading DHT database to version', TARGET_VERSION);
        db = request.result;
        if (!db.objectStoreNames.contains('store')) {
          db.createObjectStore('store', { keyPath: 'id' });
          console.log('Created object store: store in dht.js');
        }
        if (!db.objectStoreNames.contains('transactions')) {
          db.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true });
          console.log('Created object store: transactions in dht.js');
        }
        if (!db.objectStoreNames.contains('offlineQueue')) {
          db.createObjectStore('offlineQueue', { keyPath: 'id', autoIncrement: true });
          console.log('Created object store: offlineQueue in dht.js');
        }
        if (!db.objectStoreNames.contains('chunkCache')) {
          db.createObjectStore('chunkCache', { keyPath: 'id' });
          console.log('Created object store: chunkCache in dht.js');
        }
        console.log('DHT database upgrade completed');
      };

      request.onsuccess = () => {
        db = request.result;
        console.log('DHT IndexedDB opened at version', db.version);
        const requiredStores = ['store', 'transactions', 'offlineQueue', 'chunkCache'];
        const missingStores = requiredStores.filter(store => !db.objectStoreNames.contains(store));
        if (missingStores.length > 0) {
          console.error('Missing stores after upgrade:', missingStores);
          reject(new Error(`Database upgrade failed: missing stores ${missingStores.join(', ')}`));
        } else {
          this.db = db;
          console.log('All required stores present, proceeding with DHT initialization');
          resolve();
        }
      };

      request.onerror = (error) => {
        console.error('Failed to open DHT IndexedDB:', error.target.error);
        reject(new Error(`Failed to open IndexedDB: ${error.target.error.message}`));
      };
    });
  }

  async syncUserData() {
    if (!this.db) throw new Error('IndexedDB not initialized');
    try {
      await this.dbPut('store', { id: 'dcrypt_identity', value: this.keypair }); // Store as string
      await this.updateBalance();
      if (this.activeNodes.size > 0) {
        await this.processOfflineQueue();
      }
      const userData = {
        type: 'userData',
        peerId: this.peerId,
        keypair: this.keypair, // Send as string
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

  async saveUserData() {
    if (!this.db) throw new Error('IndexedDB not initialized');
    try {
      await this.dbPut('store', { id: 'dcrypt_identity', value: this.keypair }); // Store as string
      await this.updateBalance();
      console.log('User data saved to IndexedDB');
    } catch (error) {
      console.error('Save failed:', error);
      throw error;
    }
  }

  async initSwarm() {
    try {
      this.peerId = this.isNode ? `node-${this.keypair}` : this.keypair;
      console.log('Initializing PeerJS with Peer ID:', this.peerId);

      this.peer = new Peer(this.peerId, {
        host: '0.peerjs.com',
        port: 443,
        path: '/',
        secure: true,
        debug: 2
      });

      return await new Promise((resolve, reject) => {
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

          window.addEventListener('beforeunload', () => {
            if (this.peer && !this.peer.destroyed) {
              this.peer.destroy();
              console.log('PeerJS peer destroyed on page unload');
            }
          });

          setInterval(() => this.discoverPeers(), 5000);
          setInterval(() => this.measureLatency(), 60000);
          resolve();
        });

        this.peer.on('error', err => {
          console.error('PeerJS initialization error:', err);
          reject(err);
        });
      });
    } catch (error) {
      console.error('initSwarm failed:', error);
      throw error;
    }
  }

  discoverPeers() {
    console.log('Discovering peers...');
    console.log('My peer ID:', this.peerId);
    console.log('Known peer IDs:', Array.from(this.nodes));
    const knownPeerIds = [
      ...Array.from(this.nodes)
    ].filter(id => id !== this.peerId); // Avoid connecting to self

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

  handlePeerDisconnect(peerId) {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.connected = false;
      peer.conn = null;
      this.activeNodes.delete(peerId);
      console.log(`Peer disconnected: ${peerId}. Will attempt to reconnect on next discovery.`);
    }
  }

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

  broadcastChunk(chunkHash) {
    const message = { type: 'chunk', chunkHash, peerId: this.peerId };
    this.broadcast(message);
    console.log(`Broadcasted chunk ${chunkHash} to ${this.activeNodes.size} peers`);
  }

  async publishIP(metadata, content, fileType) {
    if (!this.db) throw new Error('IndexedDB not initialized');
    if (!this.keypair) throw new Error('Keypair not initialized');

    try {
      const tags = Array.isArray(metadata.tags)
        ? metadata.tags.map(tag => String(tag).trim()).filter(tag => tag !== '')
        : [];
      console.log('Processed tags:', tags);

      const isPremium = !!metadata.isPremium;
      const priceUsd = isPremium ? (metadata.priceUsd || 30) : 0;

      const contentArray = new Uint8Array(content);
      const contentType = metadata.content_type || '';
      const creatorId = this.keypair; // Use string keypair directly
      const fileTypeSafe = fileType || 'text/plain';

      const ip = createIntellectualProperty(
        contentArray,
        contentType,
        tags,
        isPremium,
        priceUsd,
        creatorId,
        fileTypeSafe
      );

      const contentBytes = getIpContent(ip);
      const ipHashBytes = await computeFullHash(contentBytes);
      const ipHash = this.uint8ArrayToBase64Url(ipHashBytes);

      const activeNodeList = Array.from(this.activeNodes).filter(peerId => peerId.startsWith('node-'));
      const minChunks = activeNodeList.length > 0 ? activeNodeList.length : 1;
      const chunks = await chunkEncrypt(ip, Array.from(this.keypair), minChunks);

      const chunkHashes = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const chunkHashBytes = await getChunkHash(chunk);
        const chunkHash = this.uint8ArrayToBase64Url(chunkHashBytes);
        chunkHashes.push(chunkHash);
      }

      const updatedMetadata = {
        ...metadata,
        chunk_count: chunks.length,
        isPremium,
        priceUsd: isPremium ? priceUsd : 0,
      };

      const ipObject = { metadata: updatedMetadata, chunks: chunkHashes };
      this.knownObjects.set(ipHash, ipObject);
      await this.dbPut('store', { id: ipHash, value: JSON.stringify(ipObject) });

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
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

  broadcastIP(ipHash, metadata, chunkHashes) {
    const message = { type: 'ip', ipHash, metadata, chunkHashes, peerId: this.peerId };
    this.broadcast(message);
    console.log(`Broadcasted IP ${ipHash} to ${this.activeNodes.size} peers`);
  }

  async requestData(ipHash) {
    if (!this.db) throw new Error('IndexedDB not initialized');
    try {
      if (!ipHash || typeof ipHash !== 'string') throw new Error('Invalid IP hash');

      const ipObject = this.knownObjects.get(ipHash);
      if (!ipObject) throw new Error('IP not found');

      const chunks = [];
      for (const chunkHash of ipObject.chunks) {
        const cachedChunk = await this.dbGet('chunkCache', chunkHash);
        if (cachedChunk && cachedChunk.value) {
          chunks.push({ chunk: cachedChunk.value, hash: chunkHash });
          continue;
        }

        const peersWithChunk = this.chunkToPeerMap.get(chunkHash);
        if (!peersWithChunk || peersWithChunk.size === 0) {
          throw new Error(`No peers found with chunk ${chunkHash}`);
        }

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

      const sortedChunks = chunks.sort((a, b) => {
        const indexA = getChunkIndex(a.chunk);
        const indexB = getChunkIndex(b.chunk);
        return indexA - indexB;
      });

      const decryptedData = [];
      for (const { chunk } of sortedChunks) {
        const decryptedChunk = await decryptChunk(chunk, this.keypair.split(''));
        decryptedData.push(decryptedChunk);
      }

      const fullData = new Uint8Array(decryptedData.reduce((acc, chunk) => acc + chunk.length, 0));
      let offset = 0;
      for (const chunk of decryptedData) {
        fullData.set(chunk, offset);
        offset += chunk.length;
      }

      const fileType = getChunkFileType(sortedChunks[0].chunk);
      return { data: fullData, fileType };
    } catch (error) {
      console.error('requestData failed:', error);
      throw error;
    }
  }

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

  handleChunkResponse均匀(data) {
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

  async distributeCommission(commission) {
    const activeNodeList = Array.from(this.activeNodes).filter(peerId => peerId.startsWith('node-'));
    if (activeNodeList.length === 0) {
      console.log('No active nodes to distribute commission to.');
      return;
    }

    const commissionPerNode = commission / activeNodeList.length;
    console.log(`Distributing commission of ${commission} to ${activeNodeList.length} nodes (${commissionPerNode} per node)`);

    for (const nodePeerId of activeNodeList) {
      const base64Keypair = nodePeerId.replace('node-', '');
      const nodeKeypair = this.base64UrlToUint8Array(base64Keypair);
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

  
  async getBalance(keypair) {
    if (!this.db) throw new Error('IndexedDB not initialized');
    const balance = await this.dbGet('store', 'balance_' + keypair); // Use string keypair
    return balance && balance.value ? parseFloat(balance.value) : 0;
  }

  async putBalance(keypair, amount) {
    if (!this.db) throw new Error('IndexedDB not initialized');
    if (typeof amount !== 'number' || amount < 0) {
      throw new Error('Invalid balance amount');
    }
    await this.dbPut('store', { id: 'balance_' + keypair, value: amount.toString() }); // Use string keypair
    if (this.activeNodes.size > 0) {
      this.broadcast({
        type: 'userData',
        peerId: this.peerId,
        keypair: this.keypair,
        balance: amount,
        timestamp: Date.now()
      });
    }
  }

  async updateBalance() {
    if (!this.db) throw new Error('IndexedDB not initialized');
    const balance = await this.getBalance(this.keypair);
    await this.putBalance(this.keypair, balance);
  }

  async queueOfflineOperation(operation) {
    if (!this.db) throw new Error('IndexedDB not initialized');
    this.offlineQueue.push(operation);
    await this.dbAdd('offlineQueue', { id: Date.now().toString(), value: operation });
    console.log('Queued offline operation:', operation);
  }

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

  async loadIdentity() {
    if (!this.db) return;
    try {
      const base64 = await this.dbGet('store', 'dcrypt_identity');
      console.log(base64+" HEYYYYY")
      if (base64 && base64.value && typeof base64.value === 'string') {
        this.keypair = this.base64UrlToUint8Array(base64.value);
        console.log('Loaded identity from IndexedDB');
        console.log(this.keypair);
      }
    } catch (error) {
      console.error('Failed to load identity:', error);
    }
  }

  async loadOfflineQueue() {
    if (!this.db) return;
    try {
      const queue = await this.dbGetAll('offlineQueue');
      this.offlineQueue = queue.map(q => q.value);
      console.log('Loaded offline queue:', this.offlineQueue);
    } catch (error) {
      console.error('Failed to load offline queue:', error);
    }
  }

  async loadTransactions() {
    if (!this.db) return;
    try {
      const transactions = await this.dbGetAll('transactions');
      console.log('Loaded transactions:', transactions);
    } catch (error) {
      console.error('Failed to load transactions:', error);
    }
  }

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

  broadcast(message) {
    this.activeNodes.forEach(peerId => {
      if (peerId !== this.peerId) {
        const peer = this.peers.get(peerId);
        if (peer && peer.connected && peer.conn) {
          peer.conn.send(message);
        }
      }
    });
  }

  uint8ArrayToBase64Url(uint8Array) {
    const binaryString = String.fromCharCode(...uint8Array);
    const base64 = btoa(binaryString);
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  base64UrlToUint8Array(base64UrlString) {
    let base64 = base64UrlString.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }
  destroy() {
    if (this.peer && !this.peer.destroyed) {
      this.peer.destroy();
      console.log('PeerJS peer destroyed');
    }
    this.peers.clear();
    this.activeNodes.clear();
    this.pendingRequests.clear();
  }
}

export function uint8ArrayToBase64Url(uint8Array) {
  const binaryString = String.fromCharCode(...uint8Array);
  const base64 = btoa(binaryString);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}