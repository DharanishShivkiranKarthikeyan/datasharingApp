import CryptoJS from 'https://cdn.jsdelivr.net/npm/crypto-js@4.2.0/+esm';

export class DHT {
  constructor(keypair) {
    this.peers = new Map();
    this.channels = new Map();
    this.knownObjects = new Map();
    this.chunkToPeerMap = new Map();
    this.pendingRequests = new Map();
    this.db = null;
    this.keypair = keypair;
    this.activeNodes = new Set();
    this.offlineQueue = [];
    this.peerId = null;
  }

  async initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('dcrypt_db', 3);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('store')) db.createObjectStore('store', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('transactions')) db.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains('offlineQueue')) db.createObjectStore('offlineQueue', { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains('chunkCache')) db.createObjectStore('chunkCache', { keyPath: 'id' });
      };
      request.onsuccess = () => {
        this.db = request.result;
        this.loadIdentity();
        this.loadOfflineQueue();
        this.loadTransactions();
        resolve();
      };
      request.onerror = (error) => reject(new Error(`Failed to initialize IndexedDB: ${error.target.error.message}`));
    });
  }

  async syncUserData() {
    if (!this.db) throw new Error('IndexedDB not initialized');
    try {
      await this.dbPut('store', { id: 'dcrypt_identity', value: this.uint8ArrayToHex(this.keypair) });
      await this.putBalance(this.keypair, await this.getBalance(this.keypair) || 0);
    } catch (error) {
      console.error('Sync failed:', error);
      throw error;
    }
  }

  async saveUserData() {
    if (!this.db) throw new Error('IndexedDB not initialized');
    try {
      await this.dbPut('store', { id: 'dcrypt_identity', value: this.uint8ArrayToHex(this.keypair) });
      await this.updateBalance();
    } catch (error) {
      console.error('Save failed:', error);
      throw error;
    }
  }

  async initSwarm() {
    try {
      this.peerId = this.uint8ArrayToHex(this.keypair.slice(0, 16));
      console.log('Peer ID:', this.peerId);
      setInterval(() => this.discoverPeers(), 5000);
    } catch (error) {
      console.error('initSwarm failed:', error);
      throw error;
    }
  }

  discoverPeers() {
    console.log('Discovering peers...');
    const mockPeerId = 'mock-peer-' + Math.random().toString(36).substr(2, 9);
    if (!this.peers.has(mockPeerId)) {
      this.peers.set(mockPeerId, { connected: false });
      console.log('Discovered peer:', mockPeerId);
    }
  }

  async publishChunk(chunkHash, chunkData) {
    if (!this.db) throw new Error('IndexedDB not initialized');
    try {
      console.log('publishChunk: chunkHash=', chunkHash, 'chunkData=', chunkData);
      if (!chunkHash || typeof chunkHash !== 'string' || chunkHash.trim() === '') {
        throw new Error('Invalid chunk hash');
      }
      if (typeof chunkData !== 'string') chunkData = String(chunkData); // Ensure chunkData is a string
      await this.dbPut('chunkCache', { id: chunkHash, value: chunkData });
      this.chunkToPeerMap.set(chunkHash, this.peerId);
      this.broadcastChunk(chunkHash);
    } catch (error) {
      console.error('publishChunk failed:', error);
      throw error;
    }
  }

  broadcastChunk(chunkHash) {
    this.peers.forEach((peer, peerId) => {
      if (peer.connected) console.log(`Broadcasting chunk ${chunkHash} to ${peerId}`);
    });
  }

  async publishIP(metadata, chunks) {
    if (!this.db) throw new Error('IndexedDB not initialized');
    try {
      const ipHash = await this.hashObject(metadata);
      if (!ipHash || typeof ipHash !== 'string' || ipHash.trim() === '') {
        throw new Error('Invalid IP hash');
      }
      // Await all hashChunk promises
      const chunkHashes = await Promise.all(chunks.map(chunk => this.hashChunk(chunk)));
      chunks.forEach((chunk, index) => {
        console.log('publishIP: Generated chunk hash=', chunkHashes[index], 'for chunk=', chunk);
      });
      const ipObject = { metadata, chunks: chunkHashes };
      this.knownObjects.set(ipHash, ipObject);
      await this.dbPut('store', { id: ipHash, value: JSON.stringify(ipObject) });
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const chunkHash = chunkHashes[i];
        await this.publishChunk(chunkHash, chunk);
      }
      this.broadcastIP(ipHash);
    } catch (error) {
      console.error('publishIP failed:', error);
      throw error;
    }
  }

  broadcastIP(ipHash) {
    this.peers.forEach((peer, peerId) => {
      if (peer.connected) console.log(`Broadcasting IP ${ipHash} to ${peerId}`);
    });
  }

  async requestData(hash) {
    if (!this.db) throw new Error('IndexedDB not initialized');
    try {
      if (!hash || typeof hash !== 'string') throw new Error('Invalid hash');
      const peerId = this.chunkToPeerMap.get(hash);
      if (peerId && this.peers.has(peerId) && this.peers.get(peerId).connected) {
        const chunk = await this.fetchChunkFromPeer(peerId, hash);
        return chunk;
      }
      throw new Error('No available peer for requested data');
    } catch (error) {
      console.error('requestData failed:', error);
      throw error;
    }
  }

  async fetchChunkFromPeer(peerId, hash) {
    return new Promise(resolve => setTimeout(() => resolve(`Mock data for ${hash}`), 1000));
  }

  async getBalance(keypair) {
    if (!this.db) throw new Error('IndexedDB not initialized');
    const balance = await this.dbGet('store', 'balance_' + this.uint8ArrayToHex(keypair));
    return balance && balance.value ? parseFloat(balance.value) : 0;
  }

  async putBalance(keypair, amount) {
    if (!this.db) throw new Error('IndexedDB not initialized');
    await this.dbPut('store', { id: 'balance_' + this.uint8ArrayToHex(keypair), value: amount.toString() });
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
  }

  loadIdentity() {
    if (!this.db) return;
    this.dbGet('store', 'dcrypt_identity').then(hex => {
      if (hex && hex.value && typeof hex.value === 'string') this.keypair = this.hexToUint8Array(hex.value);
    });
  }

  loadOfflineQueue() {
    if (!this.db) return;
    this.dbGetAll('offlineQueue').then(queue => this.offlineQueue = queue.map(q => q.value));
  }

  loadTransactions() {
    if (!this.db) return;
    this.dbGetAll('transactions').then(transactions => console.log('Loaded transactions:', transactions.map(t => t.value)));
  }

  async dbPut(storeName, value) {
    if (!this.db) throw new Error('IndexedDB not initialized');
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(value);
      req.onsuccess = resolve;
      req.onerror = (e) => reject(new Error(`DB put failed: ${e.target.error.message}`));
    });
  }

  async dbAdd(storeName, value) {
    if (!this.db) throw new Error('IndexedDB not initialized');
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.add(value);
      req.onsuccess = resolve;
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

  async hashObject(object) {
    const hash = CryptoJS.MD5(JSON.stringify(object)).toString();
    console.log('hashObject: Generated hash=', hash, 'for object=', object);
    return hash;
  }

  async hashChunk(chunk) {
    if (typeof chunk !== 'string') chunk = String(chunk); // Ensure chunk is a string
    if (!chunk) throw new Error('Chunk cannot be empty');
    const hash = CryptoJS.MD5(chunk).toString();
    console.log('hashChunk: Generated hash=', hash, 'for chunk=', chunk);
    if (!hash || typeof hash !== 'string') {
      throw new Error('Failed to generate a valid chunk hash');
    }
    return hash;
  }

  uint8ArrayToHex(arr) {
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  hexToUint8Array(hex) {
    if (!hex || typeof hex !== 'string') return new Uint8Array(0);
    const matches = hex.match(/.{1,2}/g);
    return matches ? new Uint8Array(matches.map(byte => parseInt(byte, 16))) : new Uint8Array(0);
  }
}