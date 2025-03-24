// web/testPeers.js
import Peer from 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/+esm';
import { db } from './firebase.js';
import { doc, setDoc } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js';

// Class to simulate a peer
class TestPeer {
  constructor(uid, isNode = true) {
    this.uid = uid; // Simulated UID for the peer
    this.isNode = isNode;
    this.peerId = isNode ? `node-${uid}` : uid;
    this.peer = null;
    this.connections = new Map(); // Map of peerId -> PeerJS.DataConnection
  }

  // Initialize the peer with PeerJS
  async init() {
    console.log(`Initializing test peer with ID: ${this.peerId}`);
    this.peer = new Peer(this.peerId, {
      host: '0.peerjs.com',
      port: 443,
      path: '/',
      secure: true,
      debug: 2
    });

    return new Promise((resolve, reject) => {
      this.peer.on('open', () => {
        console.log(`Test peer ${this.peerId} is online`);
        this.setupListeners();
        resolve();
      });

      this.peer.on('error', (err) => {
        console.error(`Test peer ${this.peerId} error:`, err);
        reject(err);
      });
    });
  }

  // Set up PeerJS event listeners
  setupListeners() {
    this.peer.on('connection', (conn) => {
      console.log(`Test peer ${this.peerId} received connection from ${conn.peer}`);
      this.handleConnection(conn);
    });

    this.peer.on('disconnected', () => {
      console.log(`Test peer ${this.peerId} disconnected. Attempting to reconnect...`);
      this.peer.reconnect();
    });
  }

  // Handle incoming connections
  handleConnection(conn) {
    this.connections.set(conn.peer, conn);

    conn.on('open', () => {
      console.log(`Test peer ${this.peerId} connected to ${conn.peer}`);
      conn.send({ type: 'handshake', peerId: this.peerId });
    });

    conn.on('data', (data) => {
      console.log(`Test peer ${this.peerId} received data from ${conn.peer}:`, data);
    });

    conn.on('close', () => {
      console.log(`Test peer ${this.peerId} connection closed with ${conn.peer}`);
      this.connections.delete(conn.peer);
    });

    conn.on('error', (err) => {
      console.error(`Test peer ${this.peerId} connection error with ${conn.peer}:`, err);
    });
  }

  // Connect to another peer
  connectToPeer(peerId) {
    if (peerId === this.peerId || this.connections.has(peerId)) return;

    console.log(`Test peer ${this.peerId} attempting to connect to ${peerId}`);
    const conn = this.peer.connect(peerId, { reliable: true });

    conn.on('open', () => {
      console.log(`Test peer ${this.peerId} connected to ${peerId}`);
      this.connections.set(peerId, conn);
      conn.send({ type: 'handshake', peerId: this.peerId });
    });

    conn.on('data', (data) => {
      console.log(`Test peer ${this.peerId} received data from ${peerId}:`, data);
    });

    conn.on('close', () => {
      console.log(`Test peer ${this.peerId} connection closed with ${peerId}`);
      this.connections.delete(peerId);
    });

    conn.on('error', (err) => {
      console.error(`Test peer ${this.peerId} connection error with ${peerId}:`, err);
    });
  }
}

// Function to create and initialize 5 test peers
export async function createTestPeers() {
  const testPeers = [];
  const peerUids = [
    'test-uid-1',
    'test-uid-2',
    'test-uid-3',
    'test-uid-4',
    'test-uid-5'
  ];

  // Register each peer as a node in Firestore
  for (const uid of peerUids) {
    try {
      await setDoc(doc(db, 'nodes', uid), { active: true });
      console.log(`Registered ${uid} as a node in Firestore`);
    } catch (error) {
      console.error(`Failed to register ${uid} in Firestore:`, error);
    }
  }

  // Create and initialize test peers
  for (const uid of peerUids) {
    const peer = new TestPeer(uid, true); // All test peers are nodes
    await peer.init();
    testPeers.push(peer);
  }

  // Connect each peer to the others
  for (let i = 0; i < testPeers.length; i++) {
    for (let j = 0; j < testPeers.length; j++) {
      if (i !== j) {
        testPeers[i].connectToPeer(testPeers[j].peerId);
      }
    }
  }

  return testPeers;
}