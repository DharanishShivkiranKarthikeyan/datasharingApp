// web/node-instructions.js
import { auth } from './firebase.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js';
import { DHT } from './dht.js';

// Only run this code if we're on node-instructions.html
if (window.location.pathname === '/node-instructions.html') {
  let dht;

  document.addEventListener('DOMContentLoaded', async () => {
    showLoading(true);
    try {
      const user = await new Promise((resolve) => {
        onAuthStateChanged(auth, (user) => {
          resolve(user);
        });
      });

      if (!user) {
        showToast('Please sign in to view node instructions.');
        window.location.href = '/index.html';
        return;
      }

      const encoder = new TextEncoder();
      const keypair = encoder.encode(user.uid);

      // Initialize DHT
      dht = new DHT(keypair, true); // isNode = true since this is a node
      await dht.initDB();
      await dht.initSwarm();
      await dht.syncUserData();

      // Calculate total earnings from commissions
      const transactions = await dht.dbGetAll('transactions');
      const commissionEarnings = transactions
        .filter(tx => tx.type === 'commission')
        .reduce((total, tx) => total + (tx.amount || 0), 0);

      const nodeEarningsElement = document.getElementById('nodeEarnings');
      if (nodeEarningsElement) {
        nodeEarningsElement.textContent = `Total Earnings: ${commissionEarnings.toFixed(2)} DCT`;
      }
    } catch (error) {
      console.error('Error initializing node instructions:', error);
      showToast(`Initialization failed: ${error.message}`);
    } finally {
      showLoading(false);
    }
  });
}

function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;

  toast.textContent = message;
  toast.style.display = 'block';
  setTimeout(() => {
    toast.style.display = 'none';
  }, 3000);
}

function showLoading(show) {
  const loading = document.getElementById('loading');
  if (loading) loading.style.display = show ? 'flex' : 'none';
}