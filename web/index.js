// web/index.js
import { auth, db } from './firebase.js';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js';
import { doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js';
import { DHT } from './dht.js';
import { createTestPeers } from './testPeers.js';

let dht;
let isNode = false;
let userBalance = 0;
let testPeers = [];

// Wait for the DOM to load before accessing elements
document.addEventListener('DOMContentLoaded', () => {
  // Get DOM elements
  const loginButton = document.getElementById('loginButton');
  const logoutButton = document.getElementById('logoutButton');
  const userBalanceElement = document.getElementById('userBalance');
  const publishButton = document.getElementById('publishButton');
  const searchButton = document.getElementById('searchButton');
  const buyButton = document.getElementById('buyButton');
  const withdrawButton = document.getElementById('withdrawButton');
  const toggleHistoryButton = document.getElementById('toggleHistoryButton');
  const transactionHistory = document.getElementById('transactionHistory');
  const publishedItemsTableBody = document.getElementById('publishedItems').querySelector('tbody');

  // Verify that all required elements are found
  if (!loginButton || !logoutButton || !userBalanceElement || !publishButton || !searchButton || !buyButton || !withdrawButton || !toggleHistoryButton || !transactionHistory || !publishedItemsTableBody) {
    console.error('Required DOM elements not found:', {
      loginButton: !!loginButton,
      logoutButton: !!logoutButton,
      userBalanceElement: !!userBalanceElement,
      publishButton: !!publishButton,
      searchButton: !!searchButton,
      buyButton: !!buyButton,
      withdrawButton: !!withdrawButton,
      toggleHistoryButton: !!toggleHistoryButton,
      transactionHistory: !!transactionHistory,
      publishedItemsTableBody: !!publishedItemsTableBody
    });
    return;
  }

  // Set up event listeners
  loginButton.addEventListener('click', signIn);
  logoutButton.addEventListener('click', signOutUser);

  // Update UI based on authentication state
  onAuthStateChanged(auth, (user) => {
    if (user) {
      console.log('User is signed in:', user.uid);
      loginButton.classList.add('hidden');
      logoutButton.classList.remove('hidden');
      publishButton.disabled = false;
      searchButton.disabled = false;
      buyButton.disabled = false;
      withdrawButton.disabled = false;
      toggleHistoryButton.disabled = false;
      init();
    } else {
      console.log('No user is signed in.');
      loginButton.classList.remove('hidden');
      logoutButton.classList.add('hidden');
      publishButton.disabled = true;
      searchButton.disabled = true;
      buyButton.disabled = true;
      withdrawButton.disabled = true;
      toggleHistoryButton.disabled = true;
      updateUIForSignOut();
    }
  });

  // Expose additional functions to the global scope for HTML onclick handlers
  window.logout = signOutUser;
  window.publishSnippet = publishSnippet;
  window.buySnippet = buySnippet;
  window.searchSnippets = searchSnippets;
  window.withdraw = withdraw;
  window.toggleTransactionHistory = toggleTransactionHistory;
});

export async function init() {
  console.log('Initializing app...');
  showLoading(true);
  try {
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

    const encoder = new TextEncoder();
    const keypair = encoder.encode(user.uid);

    isNode = await checkIfUserIsNode();
    console.log(`User is ${isNode ? '' : 'not '}a node.`);

    if (testPeers.length === 0) {
      console.log('Creating test peers...');
      testPeers = await createTestPeers();
      console.log('Test peers created:', testPeers.map(p => p.peerId));
    }

    console.log('Initializing DHT...');
    dht = new DHT(keypair, isNode);
    window.dht = dht;

    await dht.initDB();
    console.log('IndexedDB initialized.');

    await dht.initSwarm();
    console.log('DHT initialized.');

    await dht.syncUserData();
    console.log('User data synced.');

    updateLiveFeed();
    console.log('Live feed updated.');

    updateBalanceDisplay();
    updateTransactionHistory();
  } catch (error) {
    console.error('Error initializing application:', error);
    showToast(`Initialization failed: ${error.message}`);
    throw error;
  } finally {
    showLoading(false);
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
    return false;
  }
}

export async function signIn() {
  const provider = new GoogleAuthProvider();
  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    console.log('Signed in user UID:', user.uid);
    showToast('Signed in successfully!');
    await init();
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
    testPeers = [];
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
    const priceInput = document.getElementById('priceInput');
    const priceUsd = isPremium && priceInput ? parseFloat(priceInput.value) || 0 : 0;

    const metadata = {
      content_type: title,
      description: description || '',
      tags: tags ? tags.split(',').map(t => t.trim()) : [],
      isPremium,
      priceUsd
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
    const priceUsd = isPremium ? (ipObject.metadata.priceUsd || 0) : 0;
    const buyCost = priceUsd; // Free if priceUsd is 0

    if (buyCost > 0) {
      const balance = await dht.getBalance(dht.keypair);
      if (balance < buyCost) throw new Error('Insufficient balance');

      const commission = buyCost * 0.05;
      await dht.distributeCommission(commission);

      await dht.putBalance(dht.keypair, balance - buyCost);
      await dht.dbAdd('transactions', { type: 'buy', amount: buyCost, timestamp: Date.now() });
    } else {
      console.log('This snippet is free!');
      await dht.dbAdd('transactions', { type: 'buy', amount: 0, timestamp: Date.now() });
    }

    const { data, fileType } = await dht.requestData(hash);
    showToast('Snippet retrieved successfully!');
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

export async function searchSnippets(query) {
  if (!isAuthenticated()) {
    showToast('Please sign in to search.');
    return;
  }

  showLoading(true);
  try {
    if (!dht) throw new Error('DHT not initialized');
    if (!query) throw new Error('Search query is required');

    const publishedItemsTableBody = document.getElementById('publishedItems').querySelector('tbody');
    publishedItemsTableBody.innerHTML = '';

    dht.knownObjects.forEach((value, key) => {
      const { content_type, description, tags } = value.metadata;
      const queryLower = query.toLowerCase();
      if (
        content_type.toLowerCase().includes(queryLower) ||
        (description && description.toLowerCase().includes(queryLower)) ||
        (tags && tags.some(tag => tag.toLowerCase().includes(queryLower)))
      ) {
        const isPremium = value.metadata.isPremium || false;
        const priceUsd = isPremium ? (value.metadata.priceUsd || 0) : 0;
        const costDisplay = priceUsd > 0 ? `${priceUsd} DCT` : 'Free';
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${content_type}</td>
          <td>${description || 'No description'}</td>
          <td>${tags.join(', ') || 'No tags'}</td>
          <td><button onclick="window.buySnippet('${key}')" class="bg-purple-500 text-white rounded hover:bg-purple-600">Get (${costDisplay})</button></td>
        `;
        publishedItemsTableBody.appendChild(row);
      }
    });

    showToast('Search completed!');
  } catch (error) {
    console.error('searchSnippets failed:', error);
    showToast(`Search failed: ${error.message}`);
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
    if (!amount || amount <= 0) throw new Error('Invalid withdrawal amount');

    const balance = await dht.getBalance(dht.keypair);
    if (balance < amount) throw new Error('Insufficient balance');

    await dht.putBalance(dht.keypair, balance - amount);
    await dht.dbAdd('transactions', { type: 'withdraw', amount, timestamp: Date.now() });

    showToast(`Withdrew ${amount} DCT successfully!`);
    updateTransactionHistory();
    updateBalanceDisplay();
    await uploadUserDataToFirebase();
  } catch (error) {
    console.error('withdraw failed:', error);
    showToast(`Withdrawal failed: ${error.message}`);
  } finally {
    showLoading(false);
  }
}

export function toggleTransactionHistory() {
  const transactionHistory = document.getElementById('transactionHistory');
  if (transactionHistory.style.display === 'none') {
    transactionHistory.style.display = 'block';
  } else {
    transactionHistory.style.display = 'none';
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
  const publishedItemsTableBody = document.getElementById('publishedItems').querySelector('tbody');
  if (!publishedItemsTableBody) return;

  publishedItemsTableBody.innerHTML = '';
  dht.knownObjects.forEach((value, key) => {
    const isPremium = value.metadata.isPremium || false;
    const priceUsd = isPremium ? (value.metadata.priceUsd || 0) : 0;
    const costDisplay = priceUsd > 0 ? `${priceUsd} DCT` : 'Free';
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${value.metadata.content_type}</td>
      <td>${value.metadata.description || 'No description'}</td>
      <td>${value.metadata.tags.join(', ') || 'No tags'}</td>
      <td><button onclick="window.buySnippet('${key}')" class="bg-purple-500 text-white rounded hover:bg-purple-600">Get (${costDisplay})</button></td>
    `;
    publishedItemsTableBody.appendChild(row);
  });
}

function updateTransactionHistory() {
  const transactionList = document.getElementById('transactionList');
  if (!transactionList) return;

  dht.dbGetAll('transactions').then(transactions => {
    if (transactions.length === 0) {
      transactionList.innerHTML = 'No transactions yet.';
      return;
    }

    transactionList.innerHTML = transactions.map(tx => {
      return `<p>${tx.type} - ${tx.amount} DCT - ${new Date(tx.timestamp).toLocaleString()}</p>`;
    }).join('');
  });
}

function updateBalanceDisplay() {
  const userBalanceElement = document.getElementById('userBalance');
  if (!userBalanceElement) return;

  dht.getBalance(dht.keypair).then(balance => {
    userBalance = balance;
    userBalanceElement.textContent = `Balance: ${balance} DCT`;
  });
}

function updateUIForSignOut() {
  const publishedItemsTableBody = document.getElementById('publishedItems').querySelector('tbody');
  const transactionList = document.getElementById('transactionList');
  const userBalanceElement = document.getElementById('userBalance');

  if (publishedItemsTableBody) publishedItemsTableBody.innerHTML = '';
  if (transactionList) transactionList.innerHTML = 'No transactions yet.';
  if (userBalanceElement) userBalanceElement.textContent = 'Balance: 0 DCT';
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

function setupPremiumToggle() {
  const premiumToggle = document.getElementById('isPremium');
  const priceInput = document.getElementById('priceInput');
  if (premiumToggle && priceInput) {
    premiumToggle.addEventListener('change', (e) => {
      console.log('Premium toggle:', e.target.checked);
      priceInput.classList.toggle('hidden', !e.target.checked);
      if (!e.target.checked) {
        priceInput.value = '';
      }
    });
  }
}