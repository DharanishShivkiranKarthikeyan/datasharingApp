import Peer from 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/+esm';

// Generate a UUID for test peers
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export async function createTestPeers() {
  const peers = [];
  const numTestPeers = 3;

  for (let i = 0; i < numTestPeers; i++) {
    const peerId = `node-test-${generateUUID()}`; // Generate a unique ID for each test peer
    console.log(`Initializing test peer with ID: ${peerId}`);

    const peer = new Peer(peerId, {
      host: '0.peerjs.com',
      port: 443,
      path: '/',
      secure: true,
      debug: 2
    });

    const peerPromise = new Promise((resolve, reject) => {
      peer.on('open', () => {
        console.log(`Test peer ${peerId} opened`);
        peers.push([peer, peerId]);
        resolve();
      });

      peer.on('error', (err) => {
        console.error(`Test peer ${peerId} error:`, err);
        reject(err);
      });

      peer.on('disconnected', () => {
        console.log(`Test peer ${peerId} disconnected`);
      });
    });

    try {
      await peerPromise;
    } catch (error) {
      console.error(`Failed to initialize test peer ${peerId}:`, error);
    }
  }

  return peers;
}