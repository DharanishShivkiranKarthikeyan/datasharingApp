import CryptoJS from 'https://cdn.jsdelivr.net/npm/crypto-js@4.2.0/+esm';
import Peer from 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/+esm';
import { db } from './firebase.js';
import { collection, getDocs } from 'firebase/firestore';
import { createIntellectualProperty, getIpContent, computeFullHash, chunkEncrypt, getChunkHash, getIpMetadata, getChunkIndex, decryptChunk, getChunkFileType } from './utils.js';

export class DHT {
  constructor(keypair, isNode = false) {
    this.peers = new Map();
    this.knownObjects = new Map();
    this.chunkToPeerMap = new Map();
    this.pendingRequests = new Map();
    this.db = null;
    this.keypair = keypair;
    this.activeNodes = new Set();
    this.nodes = new Set();
    this.offlineQueue = [];
    this.isNode = isNode;
    this.peerId = null;
    this.peer = null;
    this.connectionAttempts = new Map();
    this.maxConnectionAttempts = 3;
    this.baseRetryDelay = 2000;
    this.averageLatency = 0;
    console.log('DHT initialized with keypair:', keypair);
    this.initializeKnownNodes();
  }

  async initializeKnownNodes() {
    const fetchNodes = async () => {
      try {
        if (!db) {
          console.error('Firestore not initialized');
          return;
        }
        const nodesSnapshot = await getDocs(collection(db, 'nodes'));
        this.nodes.clear();
        if (!nodesSnapshot.empty) {
          nodesSnapshot.forEach(doc => {
            const data = doc.data();
            if (data.peerId) this.nodes.add(data.peerId);
          });
        }
        console.log('Fetched nodes:', Array.from(this.nodes));
      } catch (error) {
        console.error('Failed to fetch nodes from Firestore:', error);
        this.nodes.clear();
      }
    };
    await fetchNodes();
    setInterval(fetchNodes, 1 * 60 * 1000);
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
      await this.dbPut('store', { id: 'dcrypt_identity', value: this.keypair });
      await this.updateBalance();
      if (this.activeNodes.size > 0) await this.processOfflineQueue();
      const userData = { type: 'userData', peerId: this.peerId, keypair: this.keypair, balance: await this.getBalance(this.keypair), timestamp: Date.now() };
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
      await this.dbPut('store', { id: 'dcrypt_identity', value: this.keypair });
      await this.updateBalance();
      console.log('User data saved to IndexedDB');
    } catch (error) {
      console.error('Save failed:', error);
      throw error;
    }
  }

  async initSwarm() {
    try {
      this.peerId = this.isNode ? `node-${this.keypair}` : `${this.keypair}`;
      console.log('Initializing PeerJS with Peer ID:', this.peerId);
      this.peer = new Peer(this.peerId, { host: '0.peerjs.com', port: 443, path: '/', secure: true, debug: 2 });

      return await new Promise((resolve, reject) => {
        this.peer.on('open', id => {
          console.log(`PeerJS connection opened with ID: ${id}`);
          this.activeNodes.add(this.peerId);
          this.peer.on('connection', conn => this.handleConnection(conn));
          this.peer.on('error', err => {
            console.error('PeerJS error:', err.type, err.message);
            if (err.type === 'peer-unavailable') {
              const peerId = err.message.match(/Peer (.+) is unavailable/)?.[1];
              if (peerId) this.handlePeerDisconnect(peerId);
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
          setTimeout(() => {
            setInterval(() => this.discoverPeers(), 3000);
            this.discoverPeers();
          }, 5000);
          setInterval(() => this.measureLatency(), 60000);
          resolve();
        });
        this.peer.on('error', err => reject(err));
      });
    } catch (error) {
      console.error('initSwarm failed:', error);
      throw error;
    }
  }

  discoverPeers() {
    console.log('Discovering peers...');
    const knownPeerIds = [...Array.from(this.nodes)].filter(id => id !== this.peerId);
    if (knownPeerIds.length === 0) {
      console.warn('No known peers to connect to.');
      return;
    }
    knownPeerIds.forEach(peerId => {
      if (!this.peers.has(peerId)) {
        this.peers.set(peerId, { connected: false, conn: null });
        console.log('Discovered peer:', peerId, 'Current peerId:', this.peerId);
        this.connectToPeer(peerId);
      } else if (!this.peers.get(peerId).connected) {
        console.log('Retrying connection to:', peerId);
        this.connectToPeer(peerId);
      }
    });
    this.peers.forEach((peer, peerId) => {
      if (!peer.connected && (this.connectionAttempts.get(peerId) || 0) >= this.maxConnectionAttempts) {
        console.log(`Removing unreachable peer: ${peerId} after ${this.maxConnectionAttempts} attempts`);
        this.peers.delete(peerId);
        this.connectionAttempts.delete(peerId);
        this.activeNodes.delete(peerId);
      }
    });
  }

  connectToPeer(peerId) {
    if (this.peers.get(peerId)?.connected) return;
    const attempts = this.connectionAttempts.get(peerId) || 0;
    if (attempts >= this.maxConnectionAttempts) {
      console.log(`Max attempts reached for ${peerId}`);
      return;
    }
    const delay = this.baseRetryDelay * Math.pow(2, attempts - 1);
    console.log(`Connecting to peer: ${peerId} (Attempt ${attempts + 1}/${this.maxConnectionAttempts}) with delay ${delay}ms`);
    const conn = this.peer.connect(peerId, { reliable: true });
    let connectionTimeout;
    conn.on('open', () => {
      clearTimeout(connectionTimeout);
      console.log(`Connected to peer: ${peerId} with local peerId: ${this.peerId}`);
      this.peers.set(peerId, { connected: true, conn });
      this.activeNodes.add(peerId);
      this.connectionAttempts.delete(peerId);
      conn.send({ type: 'handshake', peerId: this.peerId });
    });
    conn.on('data', data => this.handlePeerData(data, peerId));
    conn.on('close', () => this.handlePeerDisconnect(peerId));
    conn.on('error', err => {
      console.warn(`Connection error with peer ${peerId}: ${err.message}, Attempt: ${attempts + 1}`);
      this.handlePeerDisconnect(peerId);
    });
    connectionTimeout = setTimeout(() => {
      if (!this.peers.get(peerId)?.connected) {
        this.connectionAttempts.set(peerId, attempts + 1);
        if (attempts + 1 < this.maxConnectionAttempts) {
          setTimeout(() => this.connectToPeer(peerId), delay);
        }
      }
    }, 10000);
  }

  handleConnection(conn) {
    const peerId = conn.peer;
    console.log(`Incoming connection from peer: ${peerId}`);
    this.peers.set(peerId, { connected: true, conn });
    this.activeNodes.add(peerId);
    conn.on('data', data => this.handlePeerData(data, peerId));
    conn.on('close', () => this.handlePeerDisconnect(peerId));
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
      console.log(`Peer disconnected: ${peerId}. Will reconnect on next discovery.`);
    }
  }

  handlePeerData(data, peerId) {
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
        if (peer && peer.connected && peer.conn) peer.conn.send({ type: 'pong', requestId: data.requestId });
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
      if (!chunkHash || typeof chunkHash !== 'string' || chunkHash.trim() === '') throw new Error('Invalid chunk hash');
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
    const message = { type: 'chunk', chunkHash, peerId: this.peerId };
    this.broadcast(message);
    console.log(`Broadcasted chunk ${chunkHash} to ${this.activeNodes.size} peers`);
  }

  async publishIP(metadata, content, fileType) {
    if (!this.db || !this.keypair) throw new Error('IndexedDB or keypair not initialized');
    try {
      const tags = Array.isArray(metadata.tags) ? metadata.tags.map(tag => String(tag).trim()).filter(tag => tag !== '') : [];
      const isPremium = !!metadata.isPremium;
      const priceUsd = isPremium ? (metadata.priceUsd || 30) : 0;
      const contentArray = new Uint8Array(content);
      const contentType = metadata.content_type || '';
      const creatorId = this.keypair;
      const fileTypeSafe = fileType || 'text/plain';
      const ip = createIntellectualProperty(contentArray, contentType, tags, isPremium, priceUsd, creatorId, fileTypeSafe);
      const contentBytes = getIpContent(ip);
      const ipHashBytes = await computeFullHash(contentBytes);
      const ipHash = this.uint8ArrayToBase64Url(ipHashBytes);
      const activeNodeList = Array.from(this.activeNodes).filter(peerId => peerId.startsWith('node-'));
      const minChunks = activeNodeList.length > 0 ? activeNodeList.length : 1;
      const chunks = await chunkEncrypt(ip, this.keypair, minChunks);
      const chunkHashes = await Promise.all(chunks.map(chunk => getChunkHash(chunk).then(hash => this.uint8ArrayToBase64Url(hash))));
      const updatedMetadata = { ...metadata, chunk_count: chunks.length, isPremium, priceUsd };
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
      const decryptedData = await Promise.all(sortedChunks.map(({ chunk }) => decryptChunk(chunk, this.keypair)));
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
    if (!peer || !peer.connected || !peer.conn) throw new Error(`Peer ${peerId} is not connected`);
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
        const peer = this.peers.get(peerId);
        if (peer && peer.connected && peer.conn) {
          peer.conn.send({ type: 'chunkResponse', requestId, chunkHash, chunkData: chunk.value, peerId: this.peerId });
          console.log(`Sent chunk ${chunkHash} to peer ${peerId}`);
        }
      } else {
        console.warn(`Chunk ${chunkHash} not found for peer ${peerId}`);
      }
    }).catch(error => console.error(`Failed to retrieve chunk ${chunkHash} for peer ${peerId}:`, error));
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
      const base64Keypair = nodePeerId.replace('node-', '').split('-')[0];
      const nodeKeypair = this.base64UrlToUint8Array(base64Keypair);
      const currentBalance = await this.getBalance(nodeKeypair);
      const newBalance = currentBalance + commissionPerNode;
      await this.putBalance(nodeKeypair, newBalance);
      const nodePeer = this.peers.get(nodePeerId);
      if (nodePeer && nodePeer.connected && nodePeer.conn) {
        nodePeer.conn.send({ type: 'commission', amount: commissionPerNode, newBalance, peerId: this.peerId });
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
      this.broadcast({ type: 'userData', peerId: this.peerId, keypair: this.keypair, balance: amount, timestamp: Date.now() });
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
      if (peerId !== this.peerId) {
        const peer = this.peers.get(peerId);
        if (peer && peer.connected && peer.conn) peer.conn.send(message);
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
    if (this.peer && !this.peer.destroyed) {
      this.peer.destroy();
      console.log('PeerJS peer destroyed');
    }
    this.peers.clear();
    this.activeNodes.clear();
    this.pendingRequests.clear();
  }
}