import { loadWasmModule } from './wasm.js';
import { DHT } from './dht.js';
import CryptoJS from 'https://cdn.jsdelivr.net/npm/crypto-js@4.2.0/+esm';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';

// Firebase configuration (using the values you provided)
const firebaseConfig = {
  apiKey: "AIzaSyBrdrwvY-lPObZgortEgw7YWycUOGsBlyM",
  authDomain: "dcrypt-edb9c.firebaseapp.com",
  projectId: "dcrypt-edb9c",
  storageBucket: "dcrypt-edb9c.firebasestorage.app",
  messagingSenderId: "952133736604",
  appId: "1:952133736604:web:32d799360f200bce84f559",
  measurementId: "G-7KCDLQ6JNH"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Global variables
let wasmModule = null;
let dht = null;
let currentUser = null;

// Initialize the app with Firebase authentication
document.addEventListener('DOMContentLoaded', () => {
  const loginButton = document.getElementById('loginButton');
  const logoutButton = document.getElementById('logoutButton');

  auth.onAuthStateChanged(user => {
    if (user) {
      currentUser = user;
      loginButton.classList.add('hidden');
      logoutButton.classList.remove('hidden');
      if (!dht) {
        init().catch(error => {
          console.error('Initialization on auth state change failed:', error);
          showToast(`Initialization failed: ${error.message}`);
        });
      }
    } else {
      currentUser = null;
      loginButton.classList.remove('hidden');
      logoutButton.classList.add('hidden');
    }
  });

  loginButton.addEventListener('click', async () => {
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      currentUser = result.user;
      loginButton.classList.add('hidden');
      logoutButton.classList.remove('hidden');
      if (!dht) {
        await init();
      }
    } catch (error) {
      console.error('Sign-in failed:', error.code, error.message);
      showToast(`Sign-in failed: ${error.message}`);
    }
  });

  logoutButton.addEventListener('click', async () => {
    await logout();
  });
});

// Exported Functions
export async function init() {
  console.log('Initializing app...');
  showLoading(true);
  try {
    // Load Wasm module first (since DHT might depend on it)
    console.log('Loading WASM module...');
    wasmModule = await loadWasmModule();
    console.log('WASM module loaded successfully.');

    // Create a temporary keypair for DHT instantiation
    let keypair = new Uint8Array(32);
    crypto.getRandomValues(keypair);

    // Instantiate DHT early
    console.log('Initializing DHT...');
    dht = new DHT(keypair);
    window.dht = dht;

    // Initialize IndexedDB before restoring data
    await dht.initDB();
    console.log('IndexedDB initialized.');

    // Fetch user data and update keypair if necessary
    const userData = await fetchUserDataFromFirebase();
    if (userData && userData.keypair) {
      if (!dht) throw new Error('DHT not initialized before accessing hexToUint8Array');
      keypair = dht.hexToUint8Array(userData.keypair);
      // Re-instantiate DHT with the correct keypair
      dht = new DHT(keypair);
      window.dht = dht;
      // Re-initialize IndexedDB since we re-instantiated DHT
      await dht.initDB();
      await restoreIndexedDB(userData);
    }

    await dht.initSwarm();
    console.log('DHT initialized.');

    console.log('Syncing user data...');
    await dht.syncUserData();
    console.log('Updating live feed...');
    updateLiveFeed();
    console.log('Live feed updated.');

    await updateBalanceDisplay();

    if ('serviceWorker' in navigator) {
      console.log('Service worker registration skipped for debugging');
    }
  } catch (error) {
    console.error('Error initializing application:', error);
    showToast(`Initialization failed: ${error.message}`);
    throw error; // Re-throw to catch in calling context
  } finally {
    showLoading(false);
    exposeGlobalFunctions();
    setupPremiumToggle();
  }
}

async function fetchUserDataFromFirebase() {
  if (!currentUser) return null;
  try {
    const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
    if (userDoc.exists()) {
      return userDoc.data();
    }
    return null;
  } catch (error) {
    console.error('Failed to fetch user data from Firebase:', error);
    showToast(`Failed to fetch user data: ${error.message}`);
    return null;
  }
}

async function restoreIndexedDB(userData) {
  if (!dht || !userData) return;
  try {
    if (userData.keypair) {
      await dht.dbPut('store', { id: 'dcrypt_identity', value: userData.keypair });
    }
    if (userData.balance !== undefined) {
      await dht.putBalance(dht.keypair, userData.balance);
    }
    if (userData.transactions) {
      for (const transaction of userData.transactions) {
        await dht.dbAdd('transactions', transaction);
      }
    }
    if (userData.chunkCache) {
      for (const [id, value] of Object.entries(userData.chunkCache)) {
        await dht.dbPut('chunkCache', { id, value });
      }
    }
  } catch (error) {
    console.error('Failed to restore IndexedDB:', error);
    showToast(`Failed to restore data: ${error.message}`);
  }
}

async function exportIndexedDB() {
  if (!dht) return null;
  try {
    const keypair = await dht.dbGet('store', 'dcrypt_identity');
    const balance = await dht.getBalance(dht.keypair);
    const transactions = await dht.dbGetAll('transactions');
    const chunkCacheEntries = await dht.dbGetAll('chunkCache');
    const chunkCache = {};
    chunkCacheEntries.forEach(entry => {
      chunkCache[entry.id] = entry.value;
    });

    return {
      keypair: keypair ? keypair.value : null,
      balance,
      transactions,
      chunkCache
    };
  } catch (error) {
    console.error('Failed to export IndexedDB:', error);
    return null;
  }
}

async function uploadUserDataToFirebase() {
  if (!currentUser) return;
  const maxRetries = 3;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      const data = await exportIndexedDB();
      if (data) {
        await setDoc(doc(db, 'users', currentUser.uid), data, { merge: true });
        console.log(`Firestore updated for user ${currentUser.uid} at ${new Date().toISOString()}`);
        return; // Success, exit the loop
      }
    } catch (error) {
      attempt++;
      console.error(`Failed to upload user data to Firebase (attempt ${attempt}/${maxRetries}):`, error);
      if (attempt === maxRetries) {
        console.error('Max retries reached. Data not synced to Firestore.');
        showToast('Failed to sync data to Firestore. Please try again later.');
        return;
      }
      // Wait 2 seconds before retrying
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

// Upload data on session close
window.onunload = () => {
  if (!currentUser) return;
  console.log('Session closing, relying on periodic sync for data upload');
};

async function updateBalanceDisplay() {
  if (!dht) return;
  const balance = await dht.getBalance(dht.keypair);
  const balanceElement = document.getElementById('userBalance');
  if (balanceElement) {
    balanceElement.textContent = `Balance: ${balance}`;
  }
}

export async function publishSnippet(title, description, tags, content, fileInput) {
  if (!isAuthenticated()) {
    showToast('Please sign in to publish.');
    return;
  }

  showLoading(true);
  try {
    if (!dht) throw new Error('DHT not initialized');
    if (!title) throw new Error('Title is required');
    let finalContent = content || '';

    if (fileInput && fileInput.files && fileInput.files.length > 0) {
      const file = fileInput.files[0];
      const reader = new FileReader();
      finalContent = await new Promise((resolve, reject) => {
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(new Error('Failed to read file'));
        reader.readAsText(file);
      });
    } else if (!finalContent) {
      throw new Error('Content or file is required');
    }

    const isPremium = document.getElementById('isPremium').checked;
    const metadata = { content_type: title, description: description || '', tags: tags ? tags.split(',').map(t => t.trim()) : [], isPremium };
    const chunks = [finalContent];
    await dht.publishIP(metadata, chunks);
    showToast('Snippet published successfully!');
    updateLiveFeed();
    updateTransactionHistory();
    updateBalanceDisplay();
    await uploadUserDataToFirebase(); // Sync after significant change
  } catch (error) {
    console.error('publishSnippet failed:', error);
    showToast(`Publish failed: ${error.message}`);
  } finally {
    showLoading(false);
  }
}

export async function searchSnippets(query) {
  if (!isAuthenticated()) {
    showToast('Please sign in to search.');
    return [];
  }

  showLoading(true);
  try {
    if (!dht) throw new Error('DHT not initialized');
    const results = Array.from(dht.knownObjects.entries())
      .filter(([_, ip]) => ip.metadata.content_type.includes(query) || (ip.metadata.description && ip.metadata.description.includes(query)))
      .map(([hash, ip]) => ({ hash, ...ip.metadata }));
    showToast(`Found ${results.length} results`);
    return results;
  } catch (error) {
    console.error('searchSnippets failed:', error);
    showToast(`Search failed: ${error.message}`);
    return [];
  } finally {
    showLoading(false);
  }
}

export async function buySnippet(hash) {
  if (!isAuthenticated()) {
    showToast('Please sign in to buy.');
    return null;
  }

  showLoading(true);
  try {
    if (!dht) throw new Error('DHT not initialized');
    if (!hash) throw new Error('Hash is required');

    const ipObject = dht.knownObjects.get(hash);
    if (!ipObject) throw new Error('Snippet not found');
    const isPremium = ipObject.metadata.isPremium || false;
    const buyCost = isPremium ? 30 : 5;

    const balance = await dht.getBalance(dht.keypair);
    if (balance < buyCost) throw new Error('Insufficient balance');

    await dht.putBalance(dht.keypair, balance - buyCost);
    await dht.dbAdd('transactions', { type: 'buy', amount: buyCost, timestamp: Date.now() });

    const chunk = await dht.requestData(hash);
    await dht.dbPut('chunkCache', { id: hash, value: chunk });
    showToast('Snippet purchased and cached!');
    updateTransactionHistory();
    updateBalanceDisplay();
    await uploadUserDataToFirebase(); // Sync after significant change
    return chunk;
  } catch (error) {
    console.error('buySnippet failed:', error);
    showToast(`Purchase failed: ${error.message}`);
    return null;
  } finally {
    showLoading(false);
  }
}

export async function withdraw(amount) {
  if (!isAuthenticated()) {
    showToast('Please sign in to withdraw.');
    return;
  }

  showLoading(true);
  try {
    if (!dht) throw new Error('DHT not initialized');
    if (!amount || amount <= 0) throw new Error('Valid amount required');
    const balance = await dht.getBalance(dht.keypair);
    if (balance < amount) throw new Error('Insufficient balance');
    await dht.putBalance(dht.keypair, balance - amount);
    await dht.dbAdd('transactions', { type: 'withdraw', amount, timestamp: Date.now() });
    showToast(`Withdrawn ${amount} successfully!`);
    updateTransactionHistory();
    updateBalanceDisplay();
    await uploadUserDataToFirebase(); // Sync after significant change
  } catch (error) {
    console.error('withdraw failed:', error);
    showToast(`Withdrawal failed: ${error.message}`);
  } finally {
    showLoading(false);
  }
}

export function toggleTransactionHistory() {
  if (!isAuthenticated()) {
    showToast('Please sign in to view history.');
    return;
  }
  const history = document.getElementById('transactionHistory');
  if (history) history.style.display = history.style.display === 'none' ? 'block' : 'none';
}

export async function requestData(hash) {
  if (!isAuthenticated()) {
    showToast('Please sign in to load data.');
    return null;
  }

  showLoading(true);
  try {
    if (!dht) throw new Error('DHT not initialized');
    if (!hash) throw new Error('Hash is required');
    const data = await dht.requestData(hash);
    showToast('Data loaded successfully!');
    return data;
  } catch (error) {
    console.error('requestData failed:', error);
    showToast(`Data request failed: ${error.message}`);
    return null;
  } finally {
    showLoading(false);
  }
}

// Helper Functions
function updateLiveFeed() {
  if (!isAuthenticated() || !dht) return;
  const tbody = document.querySelector('#publishedItems tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  Array.from(dht.knownObjects.entries()).forEach(([hash, ip]) => {
    const row = document.createElement('tr');
    const title = ip.metadata.content_type || 'Untitled';
    const description = ip.metadata.description || 'No description';
    const tag = ip.metadata.tags[0] || 'No Tag';
    row.innerHTML = `
      <td>${title}</td>
      <td>${description}</td>
      <td>${tag}</td>
      <td><button onclick="requestData('${hash}')">Load Data</button></td>
    `;
    tbody.appendChild(row);
  });
}

function updateTransactionHistory() {
  if (!isAuthenticated() || !dht) return;
  const list = document.getElementById('transactionList');
  if (!list) return;
  dht.dbGetAll('transactions').then(transactions => {
    list.innerHTML = transactions.map(t => `<p>${t.type}: ${t.amount} at ${new Date(t.timestamp).toLocaleString()}</p>`).join('') || 'No transactions yet.';
  });
}

function exposeGlobalFunctions() {
  const publishButton = document.getElementById('publishButton');
  const searchButton = document.getElementById('searchButton');
  const buyButton = document.getElementById('buyButton');
  const withdrawButton = document.getElementById('withdrawButton');
  const toggleHistoryButton = document.getElementById('toggleHistoryButton');

  if (publishButton) publishButton.disabled = false;
  if (searchButton) searchButton.disabled = false;
  if (buyButton) buyButton.disabled = false;
  if (withdrawButton) withdrawButton.disabled = false;
  if (toggleHistoryButton) toggleHistoryButton.disabled = false;

  window.init = init;
  window.publishSnippet = publishSnippet;
  window.searchSnippets = searchSnippets;
  window.buySnippet = buySnippet;
  window.withdraw = withdraw;
  window.toggleTransactionHistory = toggleTransactionHistory;
  window.requestData = requestData;
  window.logout = logout;
}

function setupPremiumToggle() {
  const isPremium = document.getElementById('isPremium');
  const withdrawAmount = document.getElementById('withdrawAmount');
  if (isPremium && withdrawAmount) {
    isPremium.addEventListener('change', () => {
      withdrawAmount.classList.toggle('hidden', !isPremium.checked);
      if (!isPremium.checked) withdrawAmount.value = '';
    });
  }
}

function showLoading(state) {
  const loading = document.getElementById('loading');
  if (loading) loading.style.display = state ? 'flex' : 'none';
  else console.warn(`showLoading: Loading element not found (state: ${state})`);
}

function showToast(message) {
  const toast = document.getElementById('toast');
  if (toast) {
    toast.textContent = message;
    toast.style.display = 'block';
    setTimeout(() => toast.style.display = 'none', 3000);
  } else console.warn(`showToast: Toast element not found, logging message: ${message}`);
}

// Authentication Functions
function isAuthenticated() {
  return !!currentUser;
}

export async function logout() {
  try {
    await uploadUserDataToFirebase();
    await signOut(auth);
    currentUser = null;
    window.location.reload();
  } catch (error) {
    console.error('Logout failed:', error);
    showToast(`Logout failed: ${error.message}`);
  }
}