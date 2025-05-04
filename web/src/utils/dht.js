import Peer from 'peerjs';
import { db } from './firebase.js';
import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js';

class DHT {
  constructor() {
    this.peer = null;
    this.activeNodes = new Set();
    this.peers = new Map();
    this.keypair = null;
    this.isNode = false;
    this.peerId = null;
  }

  async initSwarm(keypair, isNode = false) {
    try {
      this.keypair = keypair;
      this.isNode = isNode;
      const uniqueSuffix = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
      this.peerId = this.isNode ? `node-${this.keypair}-${uniqueSuffix}` : `${this.keypair}-${uniqueSuffix}`;
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
            reject(err);
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
      });
    } catch (error) {
      console.error('initSwarm failed:', error);
      throw error;
    }
  }

  handleConnection(conn) {
    console.log('New connection from:', conn.peer);
    conn.on('data', data => this.handleData(conn, data));
    conn.on('close', () => this.handlePeerDisconnect(conn.peer));
    conn.on('error', err => console.error('Connection error:', err));
    this.peers.set(conn.peer, conn);
  }

  async discoverPeers() {
    if (!this.peer || !this.peer.open) return;
    try {
      const querySnapshot = await getDocs(collection(db, 'nodes'));
      const knownNodes = querySnapshot.docs.map(doc => doc.data().peerId).filter(id => id !== this.peerId);
      knownNodes.forEach(peerId => {
        if (!this.peers.has(peerId) && !this.activeNodes.has(peerId)) {
          const conn = this.peer.connect(peerId);
          conn.on('open', () => {
            console.log('Connected to peer:', peerId);
            this.handleConnection(conn);
          });
          conn.on('error', err => console.error('Connection to peer failed:', err));
        }
      });
    } catch (error) {
      console.error('Error discovering peers:', error);
    }
  }

  handleData(conn, data) {
    console.log('Received data:', data);
    // Handle data logic here (e.g., store chunks, respond to queries)
  }

  handlePeerDisconnect(peerId) {
    console.log('Peer disconnected:', peerId);
    this.peers.delete(peerId);
    this.activeNodes.delete(peerId);
  }

  async dbGetAll(key) {
    // Simplified implementation for demonstration
    return [];
  }

  measureLatency() {
    // Placeholder for latency measurement
    console.log('Measuring latency...');
  }

  destroy() {
    if (this.peer && !this.peer.destroyed) {
      this.peer.destroy();
      this.peers.forEach(conn => conn.close());
      this.peers.clear();
      this.activeNodes.clear();
    }
  }
}

export default function useDht() {
  const [dht] = useState(new DHT());
  return { dht, initDht: dht.initSwarm.bind(dht), destroyDht: dht.destroy.bind(dht) };
}