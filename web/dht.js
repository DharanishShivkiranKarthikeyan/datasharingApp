import Peer from 'peerjs';
import { createLibp2p } from 'libp2p';
import { kadDHT } from '@libp2p/kad-dht';
import { db } from './firebase.js';
import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js';
import { createIntellectualProperty, getIpContent, computeFullHash, chunkEncrypt, getChunkHash, getChunkIndex, decryptChunk, getChunkFileType } from './utils.js';
import { multiaddr } from '@multiformats/multiaddr';
import { createFromPrivKey, createEd25519PeerId } from '@libp2p/peer-id-factory';

// Helper function for SHA-256 hashing using Web Crypto
async function sha256(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hash));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 40);
}

// Custom PeerJsTransport for libp2p
class PeerJsTransport {
  constructor(peer) {
    this.peer = peer;
    this.connections = new Map();
  }

  async dial(multiaddr) {
    const peerId = multiaddr.getPeerId();
    if (!peerId) throw new Error('No peer ID in multiaddr');
    const conn = this.peer.connect(peerId, { reliable: true });
    return new Promise((resolve, reject) => {
      conn.on('open', () => {
        this.connections.set(peerId, conn);
        resolve({
          id: peerId,
          remotePeer: peerId,
          remoteAddr: multiaddr,
          close: () => conn.close(),
          abort: () => conn.close(),
          getStreams: () => [{
            id: `stream-${peerId}`,
            protocol: '/webrtc/1.0.0',
            read: (cb) => {
              conn.on('data', data => cb(null, data));
              conn.on('close', () => cb(new Error('Connection closed')));
            },
            write: (data) => conn.send(data),
            close: () => conn.close(),
            abort: () => conn.close(),
          }],
        });
      });
      conn.on('error', reject);
    });
  }

  createListener(options) {
    return {
      listen: (multiaddr) => {
        this.peer.on('connection', conn => {
          this.connections.set(conn.peer, conn);
          options.onConnection?.({
            id: conn.peer,
            remotePeer: conn.peer,
            remoteAddr: multiaddr,
            close: () => conn.close(),
            abort: () => conn.close(),
            getStreams: () => [{
              id: `stream-${conn.peer}`,
              protocol: '/webrtc/1.0.0',
              read: (cb) => {
                conn.on('data', data => cb(null, data));
                conn.on('close', () => cb(new Error('Connection closed')));
              },
              write: (data) => conn.send(data),
              close: () => conn.close(),
              abort: () => conn.close(),
            }],
          });
        });
      },
      close: () => this.peer.destroy(),
      getAddrs: () => [multiaddr(`/webrtc/p2p/${this.peer.id}`)],
    };
  }

  filter(multiaddrs) {
    return multiaddrs.filter(ma => ma.protoNames().includes('webrtc'));
  }
}

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
    this.libp2p = null;
    this.kadDht = null;
    this.connectionAttempts = new Map();
    this.maxConnectionAttempts = 3;
    this.connectionRetryDelay = 5000;
    this.averageLatency = 0;
    this.bootstrapNodes = new Set();
    this.nodeLatencies = new Map();

    // Generate 160-bit Kademlia ID
    this.peerId = this.isNode ? `node-${this.keypair}` : keypair;
    sha256(this.peerId).then(hash => {
      this.kademliaId = hash;
      console.log('DHT initialized with keypair:', keypair, 'isNode:', isNode);
      this.initializeKnownNodes();
    }).catch(error => {
      console.error('Failed to generate Kademlia ID:', error);
      throw error;
    });
  }

  async initializeLibp2p() {
    if (!this.isNode) return;
    this.peer = new Peer(this.peerId, {
      host: '0.peerjs.com',
      port: 443,
      path: '/',
      secure: true,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { url: 'turn:192.158.29.39:3478?transport=tcp', credential: 'JZEOEt2V3Qb0y27GRntt2u2PAYA=', username: '28224511:1379330808' }
        ]
      },
      debug: 3
    });

    await new Promise((resolve, reject) => {
      this.peer.on('open', resolve);
      this.peer.on('error', reject);
    });

    let peerId;
    try {
      const privKeyBytes = this.base64UrlToUint8Array(this.keypair);
      peerId = await createFromPrivKey(privKeyBytes);
      const derivedId = await sha256(peerId.toString());
      if (derivedId !== this.kademliaId) {
        console.warn('Derived PeerId does not match kademliaId, generating new PeerId');
        throw new Error('PeerId mismatch');
      }
    } catch (error) {
      console.warn('Failed to create PeerId from keypair, generating new Ed25519 PeerId:', error);
      peerId = await createEd25519PeerId();
      this.kademliaId = await sha256(peerId.toString());
      this.peerId = this.isNode ? `node-${this.uint8ArrayToBase64Url(peerId.privateKey)}` : this.uint8ArrayToBase64Url(peerId.privateKey);
    }

    this.libp2p = await createLibp2p({
      peerId,
      transports: [new PeerJsTransport(this.peer)],
      addresses: {
        listen: [`/webrtc/p2p/${this.peerId}`]
      },
      services: {
        dht: kadDHT({
          kBucketSize: 20,
          clientMode: false
        })
      }
    });

    this.kadDht = this.libp2p.services.dht;
    console.log('libp2p and kad-dht initialized with PeerId:', peerId.toString());
  }

  async initializeKnownNodes() {
    const fetchNodes = async () => {
      try {
        const nodesSnapshot = await getDocs(collection(db, 'nodes'));
        this.nodes.clear();
        nodesSnapshot.forEach(doc => this.nodes.add(`node-${doc.id}`));
        console.log('Fetched nodes:', Array.from(this.nodes));

        if (this.nodes.size > 0) {
          const bootstrapNode = await this.selectBootstrapNode();
          if (bootstrapNode) {
            this.bootstrapNodes.add(bootstrapNode);
            await this.queryBootstrapNode(bootstrapNode);
          }
        }
      } catch (error) {
        console.error('Failed to fetch nodes from Firestore:', error);
        this.nodes.clear();
      }
    };

    if (this.isNode) {
      await this.initializeLibp2p();
    } else {
      await this.initSwarm();
    }

    await fetchNodes();
    setInterval(fetchNodes, 5 * 60 * 1000);

    if (this.isNode) {
      setInterval(() => this.refreshRoutingTable(), 10 * 60 * 1000);
      setInterval(() => this.republishData(), 6 * 60 * 60 * 1000);
      setInterval(() => this.cleanupDHTStore(), 24 * 60 * 60 * 1000);
    }
  }

  async selectBootstrapNode() {
    const nodes = Array.from(this.nodes).filter(id => id !== this.peerId);
    if (nodes.length === 0) return null;

    let minLatency = Infinity;
    let selectedNode = null;
    for (const nodeId of nodes.slice(0, 5)) {
      const latency = await this.measureLatencyToPeer(nodeId);
      if (latency !== null && latency < minLatency) {
        minLatency = latency;
        selectedNode = nodeId;
      }
    }
    if (!selectedNode) {
      selectedNode = nodes[Math.floor(Math.random() * nodes.length)];
    }
    return selectedNode;
  }

  async queryBootstrapNode(bootstrapNode) {
    try {
      if (!this.peer || this.peer.destroyed) {
        throw new Error('PeerJS not initialized');
      }
      await this.connectToPeer(bootstrapNode);
      const peer = this.peers.get(bootstrapNode);
      if (peer && peer.connected && peer.conn) {
        const requestId = `${bootstrapNode}-getKnownNodes-${Date.now()}`;
        peer.conn.send({ type: 'getKnownNodes', requestId, peerId: this.peerId });
        return new Promise((resolve, reject) => {
          this.pendingRequests.set(requestId, {
            resolve: (nodes) => {
              nodes.forEach(async nodeId => {
                if (nodeId !== this.peerId) {
                  this.bootstrapNodes.add(nodeId);
                  if (this.isNode && this.kadDht) {
                    const nodeHash = await sha256(nodeId);
                    this.kadDht.addPeer(nodeHash, [multiaddr(`/webrtc/p2p/${nodeId}`)]);
                    this.nodeLatencies.set(nodeHash, Infinity);
                  }
                }
              });
              console.log('Received known nodes from bootstrap:', nodes);
              resolve();
            },
            reject,
          });
          setTimeout(() => {
            if (this.pendingRequests.has(requestId)) {
              this.pendingRequests.delete(requestId);
              reject(new Error('Bootstrap query timed out'));
            }
          }, 10000);
        });
      } else {
        console.warn(`Failed to connect to bootstrap node ${bootstrapNode}`);
      }
    } catch (error) {
      console.error('Failed to query bootstrap node:', error);
    }
  }

  async measureLatencyToPeer(peerId) {
    const peer = this.peers.get(peerId);
    if (peer && peer.connected && peer.conn) {
      const start = Date.now();
      try {
        await new Promise((resolve, reject) => {
          const requestId = `${peerId}-ping-${Date.now()}`;
          peer.conn.send({ type: 'ping', requestId });
          this.pendingRequests.set(requestId, { resolve, reject });
          setTimeout(() => {
            if (this.pendingRequests.has(requestId)) {
              this.pendingRequests.delete(requestId);
              reject(new Error('Ping timeout'));
            }
          }, 2000);
        });
        const latency = Date.now() - start;
        if (this.isNode && this.kadDht) {
          const nodeHash = await sha256(peerId);
          this.nodeLatencies.set(nodeHash, latency);
        }
        return latency;
      } catch (error) {
        console.warn(`Failed to measure latency for peer ${peerId}:`, error);
        return null;
      }
    }
    return null;
  }

  async measureLatency() {
    const latencies = [];
    const peersToTest = Array.from(this.activeNodes).slice(0, 5);
    for (const peerId of peersToTest) {
      const latency = await this.measureLatencyToPeer(peerId);
      if (latency !== null) latencies.push(latency);
    }
    this.averageLatency = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
    console.log(`Average latency: ${this.averageLatency} ms`);
  }

  async refreshRoutingTable() {
    if (!this.isNode) return;
    try {
      const randomId = await sha256(String(Math.random()));
      const peers = await this.kadDht.getClosestPeers(randomId);
      for (const peer of peers) {
        await this.connectToPeer(peer.id.toString());
      }
      console.log('Refreshed routing table');
    } catch (error) {
      console.error('Failed to refresh routing table:', error);
    }
  }

  async initDB() {
    return new Promise((resolve, reject) => {
      const TARGET_VERSION = 6;
      const request = indexedDB.open('dcrypt_db', TARGET_VERSION);
      let db;

      request.onupgradeneeded = (event) => {
        db = request.result;
        if (!db.objectStoreNames.contains('store')) db.createObjectStore('store', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('transactions')) db.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains('offlineQueue')) db.createObjectStore('offlineQueue', { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains('chunkCache')) db.createObjectStore('chunkCache', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('dhtStore')) db.createObjectStore('dhtStore', { keyPath: 'id' });
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
      if (this.isNode) return;
      console.log('Initializing PeerJS with Peer ID:', this.peerId);
      this.peer = new Peer(this.peerId, {
        host: '0.peerjs.com',
        port: 443,
        path: '/',
        secure: true,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { url: 'turn:192.158.29.39:3478?transport=tcp', credential: 'JZEOEt2V3Qb0y27GRntt2u2PAYA=', username: '28224511:1379330808' }
          ]
        },
        debug: 3
      });
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
          setInterval(() => this.discoverPeers(), 3000);
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

  async discoverPeers() {
    console.log('Discovering peers...');
    const knownPeerIds = [...Array.from(this.nodes), ...Array.from(this.bootstrapNodes), ...Array.from(this.activeNodes)].filter(id => id !== this.peerId);
    if (knownPeerIds.length === 0) {
      console.warn('No known peers to connect to.');
      return;
    }
    if (this.isNode && this.kadDht) {
      const peers = await this.kadDht.getClosestPeers(this.kademliaId);
      knownPeerIds.push(...peers.map(peer => peer.id.toString()));
    }
    knownPeerIds.forEach(peerId => {
      if (!this.peers.has(peerId)) {
        this.peers.set(peerId, { connected: false, conn: null });
        console.log('Discovered peer:', peerId);
        this.connectToPeer(peerId);
      } else if (!this.peers.get(peerId).connected) {
        this.connectToPeer(peerId);
      }
    });
    if (this.peers.size > 50) {
      const peersToRemove = Array.from(this.peers.entries())
        .filter(([_, peer]) => !peer.connected)
        .sort((a, b) => (this.connectionAttempts.get(b[0]) || 0) - (this.connectionAttempts.get(a[0]) || 0))
        .slice(0, this.peers.size - 50);
      peersToRemove.forEach(async ([peerId]) => {
        this.peers.delete(peerId);
        this.connectionAttempts.delete(peerId);
        this.activeNodes.delete(peerId);
        if (this.isNode && this.kadDht) {
          const nodeHash = await sha256(peerId);
          this.kadDht.removePeer(nodeHash);
        }
      });
    }
  }

  async connectToPeer(peerId, attempt = 1) {
    if (this.peers.get(peerId)?.connected) return;
    if (!this.peer || this.peer.destroyed) {
      console.warn(`Cannot connect to peer ${peerId}: PeerJS not initialized`);
      if (attempt < this.maxConnectionAttempts) {
        setTimeout(() => this.connectToPeer(peerId, attempt + 1), this.connectionRetryDelay * attempt);
      }
      return;
    }
    console.log(`Connecting to peer: ${peerId} (Attempt ${attempt}/${this.maxConnectionAttempts})`);
    const conn = this.peer.connect(peerId, { reliable: true });
    conn.on('open', async () => {
      console.log(`Connection opened with peer: ${peerId}`);
      this.peers.set(peerId, { connected: true, conn });
      this.activeNodes.add(peerId);
      if (this.isNode && this.kadDht) {
        const nodeHash = await sha256(peerId);
        this.kadDht.addPeer(nodeHash, [multiaddr(`/webrtc/p2p/${peerId}`)]);
        this.nodeLatencies.set(nodeHash, Infinity);
      }
      conn.send({ type: 'handshake', peerId: this.peerId });
    });
    conn.on('data', (data) => {
      console.log(`Received data from peer ${peerId}:`, data);
      this.handlePeerData(data, peerId);
    });
    conn.on('close', () => {
      console.log(`Connection closed with peer ${peerId}`);
      this.handlePeerDisconnect(peerId);
    });
    conn.on('error', (err) => {
      console.error(`Connection error with peer ${peerId}:`, err);
      if (attempt < this.maxConnectionAttempts) {
        setTimeout(() => this.connectToPeer(peerId, attempt + 1), this.connectionRetryDelay * attempt);
      } else {
        console.log(`Max attempts reached for peer ${peerId}. Marking as unreachable.`);
        this.handlePeerDisconnect(peerId);
      }
    });
  }

  async handleConnection(conn) {
    const peerId = conn.peer;
    console.log(`Incoming connection from peer: ${peerId} at ${Date.now()}`);
    conn.on('open', async () => {
      console.log(`Connection opened with peer: ${peerId}`);
      this.peers.set(peerId, { connected: true, conn });
      this.activeNodes.add(peerId);
      if (this.isNode && this.kadDht) {
        const nodeHash = await sha256(peerId);
        this.kadDht.addPeer(nodeHash, [multiaddr(`/webrtc/p2p/${peerId}`)]);
        this.nodeLatencies.set(nodeHash, Infinity);
      }
    });
    conn.on('data', (data) => {
      console.log(`Received data from peer ${peerId}:`, data);
      this.handlePeerData(data, peerId);
    });
    conn.on('close', () => {
      console.log(`Connection closed with peer ${peerId}`);
      this.handlePeerDisconnect(peerId);
    });
    conn.on('error', (err) => {
      console.error(`Connection error with peer ${peerId}:`, err);
      this.handlePeerDisconnect(peerId);
    });
  }

  async handlePeerDisconnect(peerId) {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.connected = false;
      peer.conn = null;
      this.activeNodes.delete(peerId);
      if (this.isNode && this.kadDht) {
        const nodeHash = await sha256(peerId);
        this.kadDht.removePeer(nodeHash);
        this.nodeLatencies.delete(nodeHash);
      }
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
      case 'metadataRequest':
        this.handleMetadataRequest(data, peerId);
        break;
      case 'metadataResponse':
        this.handleMetadataResponse(data);
        break;
      case 'userData':
        console.log(`Received user data from peer ${peerId}:`, data);
        break;
      case 'storeChunk':
        this.storeChunkFromPeer(data.chunkHash, data.chunkData, peerId);
        break;
      case 'ping':
        let peer = this.peers.get(peerId);
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
      case 'getKnownNodes':
        let peer = this.peers.get(peerId);
        if (peer && peer.connected && peer.conn) {
          const nodes = Array.from(this.activeNodes);
          peer.conn.send({ type: 'knownNodesResponse', requestId: data.requestId, nodes, peerId: this.peerId });
        }
        break;
      case 'knownNodesResponse':
        const knownNodesRequest = this.pendingRequests.get(data.requestId);
        if (knownNodesRequest) {
          knownNodesRequest.resolve(data.nodes);
          this.pendingRequests.delete(data.requestId);
        }
        break;
      case 'storeDHT':
        this.storeDHTFromPeer(data.key, data.value, data.ttl, peerId);
        break;
      case 'findDHT':
        this.handleFindDHT(data, peerId);
        break;
      case 'findDHTResponse':
        const findRequest = this.pendingRequests.get(data.requestId);
        if (findRequest) {
          findRequest.resolve({ value: data.value, nodes: data.nodes });
          this.pendingRequests.delete(data.requestId);
        }
        break;
      default:
        console.warn(`Unknown data type from peer ${peerId}:`, data.type);
    }
  }

  async storeDHT(key, value, ttl = 86400000) {
    try {
      const keyHash = await sha256(key);
      let targetNodes = [];
      if (this.isNode && this.kadDht) {
        const peers = await this.kadDht.getClosestPeers(keyHash);
        targetNodes = peers.map(peer => ({ id: peer.id.toString() })).slice(0, 20);
      } else {
        const bootstrapNode = Array.from(this.bootstrapNodes)[0];
        if (!bootstrapNode) throw new Error('No bootstrap node available');
        targetNodes = await this.requestNodesFromPeer(bootstrapNode, keyHash);
      }
      for (const node of targetNodes) {
        const peerId = node.id || node.address;
        const peer = this.peers.get(peerId);
        if (peer && peer.connected && peer.conn) {
          peer.conn.send({ type: 'storeDHT', key, value, ttl, peerId: this.peerId });
        }
      }
      if (this.isNode && this.kadDht) {
        await this.storeDHTFromPeer(key, value, ttl, this.peerId);
        await this.kadDht.put(Buffer.from(keyHash), Buffer.from(value));
      }
      console.log(`Stored DHT key ${key} on ${targetNodes.length} nodes`);
    } catch (error) {
      console.error('Failed to store DHT key:', error);
      throw error;
    }
  }

  async storeDHTFromPeer(key, value, ttl, peerId) {
    if (!this.isNode) return;
    try {
      await this.dbPut('dhtStore', { id: key, value, ttl, timestamp: Date.now() });
      const keyHash = await sha256(key);
      await this.kadDht.put(Buffer.from(keyHash), Buffer.from(value));
      console.log(`Stored DHT key ${key} from peer ${peerId}`);
    } catch (error) {
      console.error(`Failed to store DHT key ${key} from peer ${peerId}:`, error);
    }
  }

  async findDHT(key) {
    try {
      const keyHash = await sha256(key);
      if (this.isNode && this.kadDht) {
        const value = await this.kadDht.get(Buffer.from(keyHash));
        if (value) {
          const stored = await this.dbGet('dhtStore', key);
          if (stored && stored.timestamp + stored.ttl > Date.now()) {
            return stored.value;
          }
        }
        const peers = await this.kadDht.getClosestPeers(keyHash);
        for (const peer of peers) {
          const value = await this.requestDHTFromPeer(peer.id.toString(), key);
          if (value) return value;
        }
      } else {
        const bootstrapNode = Array.from(this.bootstrapNodes)[0];
        if (!bootstrapNode) throw new Error('No bootstrap node available');
        const value = await this.requestDHTFromPeer(bootstrapNode, key);
        if (value) return value;
      }
      throw new Error(`DHT key ${key} not found`);
    } catch (error) {
      console.error('Failed to find DHT key:', error);
      throw error;
    }
  }

  async requestNodesFromPeer(peerId, keyHash) {
    const peer = this.peers.get(peerId);
    if (!peer || !peer.connected || !peer.conn) throw new Error(`Peer ${peerId} is not connected`);
    const requestId = `${peerId}-findNodes-${Date.now()}`;
    peer.conn.send({ type: 'findDHT', key: keyHash, requestId, peerId: this.peerId });
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, {
        resolve: ({ nodes }) => resolve(nodes.map(nodeId => ({ id: nodeId }))),
        reject,
      });
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error(`Request for nodes for key ${keyHash} timed out`));
        }
      }, 10000);
    });
  }

  async requestDHTFromPeer(peerId, key) {
    const peer = this.peers.get(peerId);
    if (!peer || !peer.connected || !peer.conn) throw new Error(`Peer ${peerId} is not connected`);
    const requestId = `${peerId}-findDHT-${Date.now()}`;
    peer.conn.send({ type: 'findDHT', key, requestId, peerId: this.peerId });
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, {
        resolve: ({ value, nodes }) => resolve(value || null),
        reject,
      });
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error(`Request for DHT key ${key} timed out`));
        }
      }, 10000);
    });
  }

  async handleFindDHT(data, peerId) {
    if (!this.isNode) return;
    const { key, requestId } = data;
    const peer = this.peers.get(peerId);
    if (!peer || !peer.connected || !peer.conn) return;
    const stored = await this.dbGet('dhtStore', key);
    if (stored && stored.timestamp + stored.ttl > Date.now()) {
      peer.conn.send({ type: 'findDHTResponse', requestId, value: stored.value, nodes: [], peerId: this.peerId });
    } else {
      const keyHash = await sha256(key);
      const peers = await this.kadDht.getClosestPeers(keyHash);
      peer.conn.send({ type: 'findDHTResponse', requestId, value: null, nodes: peers.map(peer => peer.id.toString()), peerId: this.peerId });
    }
  }

  async republishData() {
    if (!this.isNode) return;
    try {
      const entries = await this.dbGetAll('dhtStore');
      for (const entry of entries) {
        if (entry.timestamp + entry.ttl > Date.now()) {
          await this.storeDHT(entry.id, entry.value, entry.ttl);
        }
      }
      console.log('Republished DHT data');
    } catch (error) {
      console.error('Failed to republish DHT data:', error);
    }
  }

  async cleanupDHTStore() {
    if (!this.isNode) return;
    try {
      const tx = this.db.transaction('dhtStore', 'readwrite');
      const store = tx.objectStore('dhtStore');
      const entries = await new Promise(resolve => {
        store.getAll().onsuccess = e => resolve(e.target.result);
      });
      for (const entry of entries) {
        if (entry.timestamp + entry.ttl <= Date.now()) {
          await new Promise(resolve => {
            store.delete(entry.id).onsuccess = resolve;
          });
        }
      }
      console.log('Cleaned up expired DHT entries');
    } catch (error) {
      console.error('Failed to clean up DHT store:', error);
    }
  }

  async storeChunkFromPeer(chunkHash, chunkData, peerId) {
    if (!this.isNode) return;
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
        const chunkKeyHash = await sha256(chunkHash);
        let targetNodes = [];
        if (this.isNode && this.kadDht) {
          const peers = await this.kadDht.getClosestPeers(chunkKeyHash);
          targetNodes = peers.map(peer => ({ id: peer.id.toString() })).slice(0, 3);
        } else {
          const bootstrapNode = Array.from(this.bootstrapNodes)[0];
          if (!bootstrapNode) throw new Error('No bootstrap node available');
          targetNodes = await this.requestNodesFromPeer(bootstrapNode, chunkKeyHash);
          targetNodes = targetNodes.slice(0, 3);
        }
        targetNodes = targetNodes.filter(node => (node.id || node.address).startsWith('node-'));
        for (const node of targetNodes) {
          const nodePeerId = node.id || node.address;
          const nodePeer = this.peers.get(nodePeerId);
          if (nodePeer && nodePeer.connected && nodePeer.conn) {
            nodePeer.conn.send({ type: 'storeChunk', chunkHash, chunkData, peerId: this.peerId });
            peerSet.add(nodePeerId);
            this.chunkToPeerMap.set(chunkHash, peerSet);
            console.log(`Sent chunk ${chunkHash} to node ${nodePeerId}`);
          }
        }
        if (chunkIndex === totalChunks - 1) {
          const peerToChunkMap = {};
          this.chunkToPeerMap.forEach((peers, hash) => {
            peerToChunkMap[hash] = Array.from(peers);
          });
          const ipHash = this.chunkToIpHash.get(chunkHash) || chunkHash;
          await this.storeDHT(ipHash, JSON.stringify(peerToChunkMap));
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
      const updatedMetadata = { ...metadata, chunk_count: chunks.length, isPremium, priceUsd, chunks: chunkHashes };
      const ipObject = { metadata: updatedMetadata, chunks: chunkHashes };
      this.knownObjects.set(ipHash, ipObject);
      await this.dbPut('store', { id: ipHash, value: JSON.stringify(ipObject) });
      this.chunkToIpHash = new Map();
      chunkHashes.forEach(chunkHash => this.chunkToIpHash.set(chunkHash, ipHash));
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

  async requestData(ipObject) {
    if (!this.db) throw new Error('IndexedDB not initialized');
    try {
      if (!ipObject) throw new Error('IP not found');
      const peerToChunkMapRaw = await this.findDHT(ipObject.metadata.hash || ipObject.chunks[0]);
      const peerToChunkMap = JSON.parse(peerToChunkMapRaw);
      this.chunkToPeerMap = new Map();
      Object.entries(peerToChunkMap).forEach(([chunkHash, peers]) => {
        this.chunkToPeerMap.set(chunkHash, new Set(peers));
      });
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

  async getIPmetadata(hash) {
    try {
      const ipObject = this.knownObjects.get(hash);
      if (ipObject) return ipObject;
      const peerToChunkMapRaw = await this.findDHT(hash);
      const peerToChunkMap = JSON.parse(peerToChunkMapRaw);
      this.chunkToPeerMap = new Map();
      Object.entries(peerToChunkMap).forEach(([chunkHash, peers]) => {
        this.chunkToPeerMap.set(chunkHash, new Set(peers));
      });
      const peerEntry = Array.from(this.activeNodes).find(peerId => peerId.startsWith('node-'));
      if (!peerEntry) throw new Error('No nodes available');
      const peerId = peerEntry;
      const requestId = `${peerId}-${hash}-${Date.now()}`;
      const peer = this.peers.get(peerId);
      if (!peer || !peer.connected || !peer.conn) throw new Error(`Peer ${peerId} is not connected`);
      peer.conn.send({ type: 'metadataRequest', requestId, ipHash: hash, peerId: this.peerId });
      return new Promise((resolve, reject) => {
        this.pendingRequests.set(requestId, { resolve, reject, hash });
        setTimeout(() => {
          if (this.pendingRequests.has(requestId)) {
            this.pendingRequests.delete(requestId);
            reject(new Error(`Request for object ${hash} from peer timed out`));
          }
        }, 10000);
      });
    } catch (error) {
      console.error('getIPmetadata failed:', error);
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

  handleMetadataRequest(data, peerId) {
    const { requestId, ipHash } = data;
    const ipObject = this.knownObjects.get(ipHash);
    const peer = this.peers.get(peerId);
    if (peer && peer.connected && peer.conn) {
      peer.conn.send({ type: 'metadataResponse', requestId, ipObject, peerId: this.peerId, ipHash });
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

  async destroy() {
    if (this.peer && !this.peer.destroyed) {
      this.peer.destroy();
      console.log('PeerJS peer destroyed');
    }
    if (this.libp2p) {
      await this.libp2p.stop();
      console.log('libp2p stopped');
    }
    this.peers.clear();
    this.activeNodes.clear();
    this.pendingRequests.clear();
    this.bootstrapNodes.clear();
  }
}

export function uint8ArrayToBase64Url(uint8Array) {
  const binaryString = String.fromCharCode(...uint8Array);
  const base64 = btoa(binaryString);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}