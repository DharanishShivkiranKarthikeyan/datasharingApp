// web/node-instructions.js
import { l } from 'vite/dist/node/types.d-aGj9QkWt.js';
import { DHT } from './dht.js';

export async function initNode(){
  showLoading(true);
    try {
      // Check if the user is a node using localStorage
      const nodeId = localStorage.getItem('nodeId');
      const role = localStorage.getItem('role');
      
      localStorage.removeItem('nodeId');
      localStorage.removeItem('role');
      sessionStorage.setItem('nodeId',nodeId);
      sessionStorage.setItem('role',role)
      console.log("Moved to session storage")
      if (role !== 'node' || !nodeId) {
        showToast('You must be signed in as a node to view this page.');
        window.location.href = '/datasharingApp/signup.html';
        return;
      }


      // Initialize DHT
      dht = new DHT(nodeId, true); // isNode = true since this is a node
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