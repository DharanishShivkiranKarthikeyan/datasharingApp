import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js';
import { loadWasmModule } from './wasm.js';
import { DHT } from './dht.js';

let wasmModule;
let dht;
let isNode = false;
let userBalance = 0;

const firebaseConfig = {
  apiKey: "AIzaSyC5gJ5m0l2g0B2gJ5m0l2g0B2gJ5m0l2g0B",
  authDomain: "dcrypt-edb9c.firebaseapp.com",
  projectId: "dcrypt-edb9c",
  storageBucket: "dcrypt-edb9c.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef123456"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app); // Initialize Firestore

export async function init() {
  console.log('Initializing app...');
  showLoading(true);
  try {
    console.log('Loading WASM module...');
    wasmModule = await loadWasmModule();
    console.log('WASM module loaded successfully.');

    // Wait for authentication state to resolve
    const user = await new Promise((resolve) => {
      onAuthStateChanged(auth, (user) => {
        resolve(user);
      });
    });

    if (!user) {
      console.log('User is not authenticated. Please sign in.');
      showToast('Please sign in to continue.');
      return;
    }

    let keypair = new Uint8Array(32);
    crypto.getRandomValues(keypair);

    isNode = await checkIfUserIsNode();
    console.log(`User is ${isNode ? '' : 'not '}a node.`);

    console.log('Initializing DHT...');
    dht = new DHT(keypair, isNode, wasmModule);
    window.dht = dht;

    await dht.initDB();
    console.log('IndexedDB initialized.');

    await dht.initSwarm();
    console.log('DHT initialized.');

    await dht.syncUserData();
    console.log('User data synced.');

    updateLiveFeed();
    console.log('Live feed updated.');
  } catch (error) {
    console.error('Error initializing application:', error);
    showToast(`Initialization failed: ${error.message}`);
    throw error;
  } finally {
    showLoading(false);
    exposeGlobalFunctions();
    setupPremiumToggle();
  }
}

async function checkIfUserIsNode() {
  const user = auth.currentUser;
  if (!user) {
    console.log('No authenticated user found.');
    return false;
  }

  try {
    const nodeRef = doc(db, 'nodes', user.uid);
    const nodeSnap = await getDoc(nodeRef);
    return nodeSnap.exists();
  } catch (error) {
    console.error('Failed to check node status:', error);
    return false; // Default to false if the check fails
  }
}

export async function signIn() {
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
    showToast('Signed in successfully!');
    await init(); // Re-initialize after sign-in
  } catch (error) {
    console.error('Sign-in failed:', error);
    showToast(`Sign-in failed: ${error.message}`);
  }
}

export async function signOutUser() {
  try {
    await signOut(auth);
    showToast('Signed out successfully!');
    dht = null;
    window.dht = null;
    updateUIForSignOut();
  } catch (error) {
    console.error('Sign-out failed:', error);
    showToast(`Sign-out failed: ${error.message}`);
  }
}

export function isAuthenticated() {
  return !!auth.currentUser;
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
    let fileType = 'text/plain';

    if (fileInput && fileInput.files && fileInput.files.length > 0) {
      const file = fileInput.files[0];
      fileType = file.type || 'application/octet-stream';
      const reader = new FileReader();
      finalContent = await new Promise((resolve, reject) => {
        reader.onload = (e) => resolve(new Uint8Array(e.target.result));
        reader.onerror = (e) => reject(new Error('Failed to read file'));
        reader.readAsArrayBuffer(file);
      });
    } else {
      finalContent = new TextEncoder().encode(finalContent);
    }

    const isPremium = document.getElementById('isPremium').checked;
    const metadata = {
      content_type: title,
      description: description || '',
      tags: tags ? tags.split(',').map(t => t.trim()) : [],
      isPremium
    };
    await dht.publishIP(metadata, finalContent, fileType);
    showToast('Snippet published successfully!');
    updateLiveFeed();
    updateTransactionHistory();
    updateBalanceDisplay();
    await uploadUserDataToFirebase();
  } catch (error) {
    console.error('publishSnippet failed:', error);
    showToast(`Publish failed: ${error.message}`);
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

    const commission = buyCost * 0.05;
    await dht.distributeCommission(commission);

    await dht.putBalance(dht.keypair, balance - buyCost);
    await dht.dbAdd('transactions', { type: 'buy', amount: buyCost, timestamp: Date.now() });

    const { data, fileType } = await dht.requestData(hash);
    showToast('Snippet purchased and cached!');
    updateTransactionHistory();
    updateBalanceDisplay();
    await uploadUserDataToFirebase();
    return { data, fileType };
  } catch (error) {
    console.error('buySnippet failed:', error);
    showToast(`Purchase failed: ${error.message}`);
    return null;
  } finally {
    showLoading(false);
  }
}

async function uploadUserDataToFirebase() {
  const user = auth.currentUser;
  if (!user) return;

  try {
    const userRef = doc(db, 'users', user.uid);
    await setDoc(userRef, {
      balance: await dht.getBalance(dht.keypair),
      lastUpdated: Date.now()
    }, { merge: true });
    console.log('User data uploaded to Firebase');
  } catch (error) {
    console.error('Failed to upload user data to Firebase:', error);
  }
}

function updateLiveFeed() {
  const liveFeed = document.getElementById('liveFeed');
  if (!liveFeed) return;

  liveFeed.innerHTML = '';
  dht.knownObjects.forEach((value, key) => {
    const snippetDiv = document.createElement('div');
    snippetDiv.className = 'snippet';
    snippetDiv.innerHTML = `
      <h3>${value.metadata.content_type}</h3>
      <p>${value.metadata.description || 'No description'}</p>
      <p>Tags: ${value.metadata.tags.join(', ')}</p>
      <p>Premium: ${value.metadata.isPremium ? 'Yes' : 'No'}</p>
      <button onclick="window.buySnippet('${key}')">Buy (${value.metadata.isPremium ? '30 DCT' : '5 DCT'})</button>
    `;
    liveFeed.appendChild(snippetDiv);
  });
}

function updateTransactionHistory() {
  const historyDiv = document.getElementById('transactionHistory');
  if (!historyDiv) return;

  dht.dbGetAll('transactions').then(transactions => {
    historyDiv.innerHTML = '<h2>Transaction History</h2>';
    transactions.forEach(tx => {
      const txDiv = document.createElement('div');
      txDiv.className = 'transaction';
      txDiv.innerHTML = `<p>${tx.type} - ${tx.amount} DCT - ${new Date(tx.timestamp).toLocaleString()}</p>`;
      historyDiv.appendChild(txDiv);
    });
  });
}

function updateBalanceDisplay() {
  const balanceDiv = document.getElementById('balance');
  if (!balanceDiv) return;

  dht.getBalance(dht.keypair).then(balance => {
    userBalance = balance;
    balanceDiv.textContent = `Balance: ${balance} DCT`;
  });
}

function updateUIForSignOut() {
  const liveFeed = document.getElementById('liveFeed');
  const transactionHistory = document.getElementById('transactionHistory');
  const balanceDiv = document.getElementById('balance');
  if (liveFeed) liveFeed.innerHTML = '';
  if (transactionHistory) transactionHistory.innerHTML = '';
  if (balanceDiv) balanceDiv.textContent = 'Balance: 0 DCT';
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function showLoading(show) {
  const loading = document.getElementById('loading');
  if (loading) loading.style.display = show ? 'block' : 'none';
}

function exposeGlobalFunctions() {
  window.signIn = signIn;
  window.signOutUser = signOutUser;
  window.publishSnippet = publishSnippet;
  window.buySnippet = buySnippet;
}

function setupPremiumToggle() {
  const premiumToggle = document.getElementById('isPremium');
  if (premiumToggle) {
    premiumToggle.addEventListener('change', (e) => {
      console.log('Premium toggle:', e.target.checked);
    });
  }
}

onAuthStateChanged(auth, (user) => {
  if (user) {
    init();
  } else {
    updateUIForSignOut();
  }
});