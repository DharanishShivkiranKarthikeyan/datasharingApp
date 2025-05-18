// web/dht.js
import { createLibp2p } from 'https://cdn.jsdelivr.net/npm/libp2p@0.46.0/dist/index.min.js';
import { webRTCStar } from 'https://cdn.jsdelivr.net/npm/@libp2p/webrtc-star@8.0.0/dist/index.min.js';
import { mplex } from 'https://cdn.jsdelivr.net/npm/@libp2p/mplex@8.0.0/dist/index.min.js';
import { noise } from 'https://cdn.jsdelivr.net/npm/@chainsafe/libp2p-noise@11.0.0/dist/index.min.js';
import { generateKeyPair } from 'https://cdn.jsdelivr.net/npm/@libp2p/crypto@1.0.0/dist/index.min.js';
import { peerIdFromKeys } from 'https://cdn.jsdelivr.net/npm/@libp2p/peer-id@2.0.0/dist/index.min.js';
import { db } from './firebase.js';
import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js';
import { createIntellectualProperty, getIpContent, computeFullHash, chunkEncrypt, getChunkHash, getChunkIndex, decryptChunk, getChunkFileType } from './utils.js';

export class DHT {
  constructor(keypair, isNode = false) {
    this.peers = new Map();
    this.knownObjects = new Map();
    this.chunkToPeerMap = new Map();
    this.pendingRequests = new Map();
    this.db = null;
    this.appKeypair = keypair; // Application-level key for encryption
    this.activeNodes = new Set();
    this.nodes = new Set();
    this.offlineQueue = [];
    this.isNode = isNode;
    this.libp2pNode = null;
    this.connectionAttempts = new Map();
    this.maxConnectionAttempts = 3;
    this.connectionRetryDelay = 5000;
    this.averageLatency = 0;

    console.log('DHT initialized with keypair:', keypair);
    this.initializeKnownNodes();
  }

  async initializeKnownNodes() {
    const fetchNodes = async () => {
      try {
        const nodesSnapshot = await getDocs(collection(db, 'nodes'));
        this.nodes.clear();
        if (!nodesSnapshot.empty) {
          nodesSnapshot.forEach(doc => this.nodes.add(`node-${doc.id}`));
        }
        console.log('Fetched nodes:', Array.from(this.nodes));
      } catch (error) {
        console.error('Failed to fetch nodes from Firestore:', error);
        this.nodes.clear();
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
      if (peer && peer.connected && peer.stream) {
        const start = Date.now();
        try {
          await new Promise((resolve, reject) => {
            const requestId = `${peerId}-ping-${Date.now()}`;
            peer.stream.sink(JSON.stringify({ type: 'ping', requestId }));
            this.pendingRequests.set(requestId, { resolve, reject });
            setTimeout(() => {
              if (this.pendingRequests.has(requestId)) {
                this.pendingRequests.delete(requestId);
                reject(new Error('Ping timeout'));
              }
            }, 2000);
          });
          const latency = Date.now() - start;
          latencies.push(latency);
        } catch (error) {
          console.warn(`Failed to measure latency for peer ${peerId}: ${error.message}`);
        }
      }
    }
    this.averageLatency = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
    console.log(`Average latency: ${this.averageLatency} ms`);
  }

  async initDB() {
    return new Promise((resolve, reject) => {
      const TARGET_VERSION = 5;
      const request = indexedDB.open('dcrypt_db', TARGET_VERSION);
      let db;

      request.onupgradeneeded = (event) => {
        db = request.result;
        if (!db.objectStoreNames.contains('store')) db.createObjectStore('store', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('transactions')) db.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains('offlineQueue')) db.createObjectStore('offlineQueue', { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains('chunkCache')) db.createObjectStore('chunkCache', { keyPath: 'id' });
        console.log('DHT database upgraded to version', TARGET_VERSION);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('DHT IndexedDB opened at version', this.db.version);
        resolve();
      };

      request.onerror = (error) => reject(new Error(`Failed to open IndexedDB: ${error.target.error.message}`));
    });
  }

  async loadKnownObjects() {
    if (!this.db) throw new Error('IndexedDB not initialized');
    try {
      const tx = this.db.transaction('store', 'readonly');
      const store = tx.objectStore('store');
      const request = store.getAll();
      request.onsuccess = () => {
        request.result.forEach(item => {
          if (item.id !== 'dcrypt_identity') {
            try {
              const { metadata, chunks } = JSON.parse(item.value);
              this.knownObjects.set(item.id, { metadata, chunks });
            } catch (e) {
              console.error('Failed to parse known object:', item.id, e);
            }
          }
        });
        console.log('Loaded known objects from IndexedDB');
      };
    } catch (error) {
      console.error('Failed to load known objects:', error);
    }
  }

  async syncUserData() {
    if (!this.db) throw new Error('IndexedDB not initialized');
    try {
      await this.dbPut('store', { id: 'dcrypt_identity', value: this.appKeypair });
      await this.updateBalance();
      if (this.activeNodes.size > 0) await this.processOfflineQueue();
      const userData = { type: 'userData', peerId: this.libp2pNode.peerId.toString(), keypair: this.appKeypair, balance: await this.getBalance(this.appKeypair), timestamp: Date.now() };
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
      await this.dbPut('store', { id: 'dcrypt_identity', value: this.appKeypair });
      await this.updateBalance();
      console.log('User data saved to IndexedDB');
    } catch (error) {
      console.error('Save failed:', error);
      throw error;
    }
  }

  async initSwarm() {
    try {
      const libp2pKeypair = await generateKeyPair('Ed25519');
      const peerId = await peerIdFromKeys(libp2pKeypair.publicKey, libp2pKeypair.privateKey);
      console.log('Initializing libp2p with Peer ID:', peerId.toString());

      this.libp2pNode = await createLibp2p({
        peerId,
        transports: [webRTCStar()],
        streamMuxers: [mplex()],
        connectionEncryption: [noise()],
        addresses: {
          listen: ['/webrtc']
        }
      });

      this.libp2pNode.handle('/dht-protocol/1.0.0', async ({ stream, connection }) => {
        const peerId = connection.remotePeer.toString();
        console.log(`Incoming stream from peer: ${peerId} at ${Date.now()}`);
        this.peers.set(peerId, { connected: true, stream });
        this.activeNodes.add(peerId);
        for await (const data of stream.source) {
          this.handlePeerData(JSON.parse(data.toString()), peerId);
        }
        console.log(`Stream closed with peer: ${peerId}`);
        this.handlePeerDisconnect(peerId);
      });

      this.libp2pNode.on('error', err => {
        console.error('libp2p error:', err);
      });

      this.libp2pNode.on('peer:discovery', peerId => {
        console.log('Discovered peer:', peerId.toString());
        if (!this.peers.has(peerId.toString())) {
          this.peers.set(peerId.toString(), { connected: false, stream: null });
          this.connectToPeer(peerId.toString());
        }
      });

      window.addEventListener('beforeunload', () => {
        if (this.libp2pNode) {
          this.libp2pNode.stop();
          console.log('libp2p node stopped on page unload');
        }
      });

      setInterval(() => this.discoverPeers(), 3000);
      setInterval(() => this.measureLatency(), 60000);
    } catch (error) {
      console.error('initSwarm failed:', error);
      throw error;
    }
  }

  async discoverPeers() {
    console.log('Discovering peers...');
    const knownPeerIds = [...Array.from(this.nodes), ...Array.from(this.activeNodes)].filter(id => id !== this.libp2pNode.peerId.toString());
    if (knownPeerIds.length === 0) {
      console.warn('No known peers to connect to.');
      return;
    }
    for (const peerId of knownPeerIds) {
      if (!this.peers.has(peerId)) {
        this.peers.set(peerId, { connected: false, stream: null });
        console.log('Discovered peer:', peerId);
        await this.connectToPeer(peerId);
      } else if (!this.peers.get(peerId).connected) {
        await this.connectToPeer(peerId);
      }
    }
    this.peers.forEach((peer, peerId) => {
      if (!peer.connected && (this.connectionAttempts.get(peerId) || 0) >= this.maxConnectionAttempts) {
        console.log(`Removing unreachable peer: ${peerId}`);
        this.peers.delete(peerId);
        this.connectionAttempts.delete(peerId);
        this.activeNodes.delete(peerId);
      }
    });
  }

  async connectToPeer(peerId, attempt = 1) {
    if (this.peers.get(peerId)?.connected) return;
    console.log(`Connecting to peer: ${peerId} (Attempt ${attempt}/${this.maxConnectionAttempts})`);
    try {
      const stream = await this.libp2pNode.dialProtocol(peerId, '/dht-protocol/1.0.0');
      console.log(`Connection opened with peer: ${peerId}`);
      this.peers.set(peerId, { connected: true, stream });
      this.activeNodes.add(peerId);
      this.connectionAttempts.delete(peerId);
      stream.sink(JSON.stringify({ type: 'handshake', peerId: this.libp2pNode.peerId.toString() }));
      for await (const data of stream.source) {
        this.handlePeerData(JSON.parse(data.toString()), peerId);
      }
      console.log(`Connection closed with peer: ${peerId}`);
      this.handlePeerDisconnect(peerId);
    } catch (err) {
      console.error(`Connection error with peer ${peerId}:`, err);
      if (attempt < this.maxConnectionAttempts) {
        this.connectionAttempts.set(peerId, attempt);
        setTimeout(() => this.connectToPeer(peerId, attempt + 1), this.connectionRetryDelay * attempt);
      } else {
        console.log(`Max attempts reached for peer ${peerId}. Marking as unreachable.`);
        this.handlePeerDisconnect(peerId);
      }
    }
  }

  handlePeerDisconnect(peerId) {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.connected = false;
      peer.stream = null;
      this.activeNodes.delete(peerId);
      console.log(`Peer disconnected: ${peerId}. Will reconnect on next discovery.`);
    }
  }

  async handlePeerData(data, peerId) {
    console.log(`Received data from peer ${peerId}:`, data);
    switch (data.type) {
      case 'handshake':
        console.log(`Handshake from peer: ${peerId}`);
        this.activeNodes.add(peerId);
        break;
      case 'chunk':
        this.chunkToPeerMap.set(data.chunkHash, new Set([...(this.chunkToPeerMap.get(data.chunkHash) || []), peerId]));
        console.log(`Updated chunkToPeerMap for chunk ${data.chunkHash} with peer ${peerId}`);
        break;
      case 'ip':
        this.knownObjects.set(data.ipHash, { metadata: data.metadata, chunks: data.chunkHashes });
        await this.dbPut('store', { id: data.ipHash, value: JSON.stringify({ metadata: data.metadata, chunks: data.chunkHashes }) });
        console.log(`Received IP ${data.ipHash} from peer ${peerId}`);
        break;
      case 'chunkRequest':
        await this.handleChunkRequest(data, peerId);
        break;
      case 'chunkResponse':
        this.handleChunkResponse(data);
        break;
      case 'metadataRequest':
        await this.handleMetadataRequest(data, peerId);
        break;
      case 'metadataResponse':
        this.handleMetadataResponse(data);
        break;
      case 'userData':
        console.log(`Received user data from peer ${peerId}:`, data);
        break;
      case 'storeChunk':
        await this.storeChunkFromPeer(data.chunkHash, data.chunkData, peerId);
        break;
      case 'ping':
        const peer = this.peers.get(peerId);
        if (peer && peer.connected && peer.stream) {
          peer.stream.sink(JSON.stringify({ type: 'pong', requestId: data.requestId }));
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
        console.warn(`Unknown data type from peer ${peerId}:`, data.type);
    }
  }

  async storeChunkFromPeer(chunkHash, chunkData, peerId) {
    try {
      await this.dbPut('chunkCache', { id: chunkHash, value: chunkData });
      let peerSet = this.chunkToPeerMap.get(chunkHash) || new Set();
      peerSet.add(this.libp2pNode.peerId.toString());
      this.chunkToPeerMap.set(chunkHash, peerSet);
      console.log(`Stored chunk ${chunkHash} from peer ${peerId}`);
    } catch (error) {
      console.error(`Failed to store chunk ${chunkHash} from peer ${peerId}:`, error);
    }
  }

  async publishChunk(chunkHash, chunkData, chunkIndex, totalChunks) {
    if (!this.db) throw new Error('IndexedDB not initialized');
    try {
      if (!chunkHash || typeof chunkHash !== 'string' || chunkHash.trim() === '') throw new Error('Invalid chunk hash');
      await this.dbPut('chunkCache', { id: chunkHash, value: chunkData });
      let peerSet = this.chunkToPeerMap.get(chunkHash) || new Set();
      peerSet.add(this.libp2pNode.peerId.toString());
      this.chunkToPeerMap.set(chunkHash, peerSet);
      if (this.activeNodes.size > 0) {
        const activeNodeList = Array.from(this.activeNodes).filter(peerId => peerId.startsWith('node-'));
        if (activeNodeList.length > 0) {
          const nodeIndex = chunkIndex % activeNodeList.length;
          const targetNode = activeNodeList[nodeIndex];
          const nodePeer = this.peers.get(targetNode);
          if (nodePeer && nodePeer.connected && nodePeer.stream) {
            nodePeer.stream.sink(JSON.stringify({ type: 'storeChunk', chunkHash, chunkData, peerId: this.libp2pNode.peerId.toString() }));
            peerSet.add(targetNode);
            this.chunkToPeerMap.set(chunkHash, peerSet);
            console.log(`Sent chunk ${chunkHash} to node ${targetNode}`);
          }
        }
        const regularPeers = Array.from(this.activeNodes).filter(peerId => !peerId.startsWith('node-') && peerId !== this.libp2pNode.peerId.toString());
        if (regularPeers.length > 0) {
          const randomPeerId = regularPeers[Math.floor(Math.random() * regularPeers.length)];
          const randomPeer = this.peers.get(randomPeerId);
          if (randomPeer && randomPeer.connected && randomPeer.stream) {
            randomPeer.stream.sink(JSON.stringify({ type: 'storeChunk', chunkHash, chunkData, peerId: this.libp2pNode.peerId.toString() }));
            peerSet.add(randomPeerId);
            this.chunkToPeerMap.set(chunkHash, peerSet);
            console.log(`Sent chunk ${chunkHash} to peer ${randomPeerId}`);
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
    const message = { type: 'chunk', chunkHash, peerId: this.libp2pNode.peerId.toString() };
    this.broadcast(message);
    console.log(`Broadcasted chunk ${chunkHash} to ${this.activeNodes.size} peers`);
  }

  async publishIP(metadata, content, fileType) {
    if (!this.db || !this.appKeypair) throw new Error('IndexedDB or keypair not initialized');
    try {
      const tags = Array.isArray(metadata.tags) ? metadata.tags.map(tag => String(tag).trim()).filter(tag => tag !== '') : [];
      const isPremium = !!metadata.isPremium;
      const priceUsd = isPremium ? (metadata.priceUsd || 30) : 0;
      const contentArray = new Uint8Array(content);
      const contentType = metadata.content_type || '';
      const creatorId = this.appKeypair;
      const fileTypeSafe = fileType || 'text/plain';
      const ip = createIntellectualProperty(contentArray, contentType, tags, isPremium, priceUsd, creatorId, fileTypeSafe);
      const contentBytes = getIpContent(ip);
      const ipHashBytes = await computeFullHash(contentBytes);
      const ipHash = this.uint8ArrayToBase64Url(ipHashBytes);
      const activeNodeList = Array.from(this.activeNodes).filter(peerId => peerId.startsWith('node-'));
      const minChunks = activeNodeList.length > 0 ? activeNodeList.length : 1;
      const chunks = await chunkEncrypt(ip, this.appKeypair, minChunks);
      const chunkHashes = await Promise.all(chunks.map(chunk => getChunkHash(chunk).then(hash => this.uint8ArrayToBase64Url(hash))));
      const updatedMetadata = { ...metadata, chunk_count: chunks.length, isPremium, priceUsd, chunks: chunkHashes };
      const ipObject = { metadata: updatedMetadata, chunks: chunkHashes };
      this.knownObjects.set(ipHash, ipObject);
      await this.dbPut('store', { id: ipHash, value: JSON.stringify(ipObject) });
      for (let i = 0; i < chunks.length; i++) await this.publishChunk(chunkHashes[i], chunks[i], i, chunks.length);
      if (this.activeNodes.size > 0) this.broadcastIP(ipHash, updatedMetadata, chunkHashes);
      else await this.queueOfflineOperation({ type: 'publishIP', ipHash, metadata: updatedMetadata, chunkHashes });
      return ipHash;
    } catch (error) {
      console.error('publishIP failed:', error);
      throw error;
    }
  }

  broadcastIP(ipHash, metadata, chunkHashes) {
    const message = { type: 'ip', ipHash, metadata, chunkHashes, peerId: this.libp2pNode.peerId.toString() };
    this.broadcast(message);
    console.log(`Broadcasted IP ${ipHash} to ${this.activeNodes.size} peers`);
  }

  async requestData(ipObject) {
    if (!this.db) throw new Error('IndexedDB not initialized');
    try {
      if (!ipObject) throw new Error('IP not found');
      const chunks = [];
      for (const chunkHash of ipObject.chunks) {
        const cachedChunk = await this.dbGet('chunkCache', chunkHash);
        if (cachedChunk && cachedChunk.value) {
          chunks.push({ chunk: cachedChunk.value, hash: chunkHash });
          continue;
        }
        const peersWithChunk = this.chunkToPeerMap.get(chunkHash);
        if (!peersWithChunk || peersWithChunk.size === 0) throw new Error(`No peers found with chunk ${chunkHash}`);
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
            }
          }
        }
        if (!chunkFetched) throw lastError || new Error(`No available peer for chunk ${chunkHash}`);
      }
      const sortedChunks = chunks.sort((a, b) => getChunkIndex(a.chunk) - getChunkIndex(b.chunk));
      const decryptedData = await Promise.all(sortedChunks.map(({ chunk }) => decryptChunk(chunk, this.appKeypair)));
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

  async getIPmetadata(hash) {
    const peerEntry = this.peers.entries().next().value;
    if (!peerEntry) throw new Error('No peers available');
    const [peerId, peer] = peerEntry;
    const requestId = `${peerId}-${hash}-${Date.now()}`;
    const message = { type: 'metadataRequest', requestId, ipHash: hash, peerId: this.libp2pNode.peerId.toString() };
    peer.stream.sink(JSON.stringify(message));
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject, hash });
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error(`Request for object ${hash} from peer timed out`));
        }
      }, 10000);
    });
  }

  async fetchChunkFromPeer(peerId, hash) {
    const peer = this.peers.get(peerId);
    if (!peer || !peer.connected || !peer.stream) throw new Error(`Peer ${peerId} is not connected`);
    const requestId = `${peerId}-${hash}-${Date.now()}`;
    const message = { type: 'chunkRequest', requestId, chunkHash: hash, peerId: this.libp2pNode.peerId.toString() };
    peer.stream.sink(JSON.stringify(message));
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

  async handleChunkRequest(data, peerId) {
    const { requestId, chunkHash } = data;
    const chunk = await this.dbGet('chunkCache', chunkHash);
    if (chunk && chunk.value) {
      const peer = this.peers.get(peerId);
      if (peer && peer.connected && peer.stream) {
        peer.stream.sink(JSON.stringify({ type: 'chunkResponse', requestId, chunkHash, chunkData: chunk.value, peerId: this.libp2pNode.peerId.toString() }));
        console.log(`Sent chunk ${chunkHash} to peer ${peerId}`);
      }
    } else {
      console.warn(`Chunk ${chunkHash} not found for peer ${peerId}`);
    }
  }

  async handleMetadataRequest(data, peerId) {
    const { requestId, ipHash } = data;
    const ipObject = this.knownObjects.get(ipHash);
    const peer = this.peers.get(peerId);
    if (peer && peer.connected && peer.stream) {
      peer.stream.sink(JSON.stringify({ type: 'metadataResponse', requestId, ipObject, peerId: this.libp2pNode.peerId.toString(), ipHash }));
    }
  }

  handleMetadataResponse(data) {
    const { requestId, ipObject, ipHash } = data;
    const request = this.pendingRequests.get(requestId);
    if (request) {
      if (ipHash === request.hash) {
        request.resolve(ipObject);
      }
      this.pendingRequests.delete(requestId);
    }
  }

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
      const nodePeer = this.peers.get(nodePeerId);
      if (nodePeer && nodePeer.connected && nodePeer.stream) {
        nodePeer.stream.sink(JSON.stringify({ type: 'commission', amount: commissionPerNode, newBalance, peerId: this.libp2pNode.peerId.toString() }));
      }
    }
  }

  async getBalance(keypair) {
    if (!this.db) throw new Error('IndexedDB not initialized');
    const balance = await this.dbGet('store', 'balance_' + keypair);
    return balance && balance.value ? parseFloat(balance.value) : 0;
  }

  async putBalance(keypair, amount) {
    if (!this.db) throw new Error('IndexedDB not initialized');
    if (typeof amount !== 'number' || amount < 0) throw new Error('Invalid balance amount');
    await this.dbPut('store', { id: 'balance_' + keypair, value: amount.toString() });
    if (this.activeNodes.size > 0) {
      this.broadcast({ type: 'userData', peerId: this.libp2pNode.peerId.toString(), keypair: this.appKeypair, balance: amount, timestamp: Date.now() });
    }
  }

  async updateBalance() {
    if (!this.db) throw new Error('IndexedDB not initialized');
    const balance = await this.getBalance(this.appKeypair);
    await this.putBalance(this.appKeypair, balance);
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
    await new Promise(resolve => store.clear().onsuccess = resolve);
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
      if (peerId !== this.libp2pNode.peerId.toString()) {
        const peer = this.peers.get(peerId);
        if (peer && peer.connected && peer.stream) peer.stream.sink(JSON.stringify(message));
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
    while (base64.length % 4) base64 += '=';
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    return bytes;
  }

  destroy() {
    if (this.libp2pNode) {
      this.libp2pNode.stop();
      console.log('libp2p node stopped');
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