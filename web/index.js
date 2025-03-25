// web/index.js
import { auth, db } from './firebase.js';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js';
import { doc, getDoc, setDoc, collection, getDocs, updateDoc, increment } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js';
import { DHT } from './dht.js';
import { createTestPeers } from './testPeers.js';

// Import all other JavaScript files to ensure they're included in the bundle
import './signup.js';
import './node-instructions.js';
import './sw.js'; // Service worker (if used)
import './utils.js'; // Utility functions (if used)

let dht = null;
let isNode = false;
let userBalance = 0;
let testPeers = [];

// Wait for the DOM to load before accessing elements
document.addEventListener('DOMContentLoaded', () => {
  // Get DOM elements
  const signupButton = document.getElementById('signupButton');
  const loginButton = document.getElementById('loginButton');
  const logoutButton = document.getElementById('logoutButton');
  const userBalanceElement = document.getElementById('userBalance');
  const publishButton = document.getElementById('publishButton');
  const searchButton = document.getElementById('searchButton');
  const depositButton = document.getElementById('depositButton');
  const withdrawButton = document.getElementById('withdrawButton');
  const toggleHistoryButton = document.getElementById('toggleHistoryButton');
  const transactionHistory = document.getElementById('transactionHistory');
  const publishedItemsTableBody = document.getElementById('publishedItems').querySelector('tbody');

  // Verify that all required elements are found
  if (!signupButton || !loginButton || !logoutButton || !userBalanceElement || !publishButton || !searchButton || !depositButton || !withdrawButton || !toggleHistoryButton || !transactionHistory || !publishedItemsTableBody) {
    console.error('Required DOM elements not found:', {
      signupButton: !!signupButton,
      loginButton: !!loginButton,
      logoutButton: !!logoutButton,
      userBalanceElement: !!userBalanceElement,
      publishButton: !!publishButton,
      searchButton: !!searchButton,
      depositButton: !!depositButton,
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
      signupButton.classList.add('hidden');
      loginButton.classList.add('hidden');
      logoutButton.classList.remove('hidden');
      publishButton.disabled = false;
      searchButton.disabled = false;
      depositButton.disabled = false;
      withdrawButton.disabled = false;
      toggleHistoryButton.disabled = false;
      init();
    } else {
      console.log('No user is signed in.');
      signupButton.classList.remove('hidden');
      loginButton.classList.remove('hidden');
      logoutButton.classList.add('hidden');
      publishButton.disabled = true;
      searchButton.disabled = true;
      depositButton.disabled = true;
      withdrawButton.disabled = true;
      toggleHistoryButton.disabled = true;
      updateUIForSignOut();
    }
  });

  // Expose additional functions to the global scope for HTML onclick handlers
  window.logout = signOutUser;
  window.publishSnippet = publishSnippet;
  window.buySnippet = buySnippet;
  window.buySnippetByHash = buySnippetByHash; // New function for buying by hash
  window.searchSnippets = searchSnippets;
  window.deposit = deposit;
  window.withdraw = withdraw;
  window.toggleTransactionHistory = toggleTransactionHistory;
  window.flagSnippet = flagSnippet;
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
    // Reset state on error
    dht = null;
    window.dht = null;
    userBalance = 0;
    updateUIForSignOut();
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
    userBalance = 0;
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
    const ipHash = await dht.publishIP(metadata, finalContent, fileType);

    // Initialize snippet metadata in Firestore for ratings and moderation
    const snippetRef = doc(db, 'snippets', ipHash);
    await setDoc(snippetRef, {
      ipHash,
      flagCount: 0,
      averageRating: 0,
      reviewStatus: 'active',
      createdAt: Date.now()
    }, { merge: true });

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

    // Prompt for rating
    const rating = prompt('Please rate this snippet (1-5 stars):', '5');
    if (rating !== null) {
      const ratingValue = parseInt(rating);
      if (ratingValue >= 1 && ratingValue <= 5) {
        await submitRating(hash, ratingValue);
        showToast(`Rated ${ratingValue} stars!`);
        updateLiveFeed(); // Refresh live feed to show updated rating
      } else {
        showToast('Invalid rating. Please enter a number between 1 and 5.');
      }
    }

    // Display the snippet content
    displaySnippetContent(data, fileType, ipObject.metadata.content_type);
    return { data, fileType };
  } catch (error) {
    console.error('buySnippet failed:', error);
    showToast(`Purchase failed: ${error.message}`);
    return null;
  } finally {
    showLoading(false);
  }
}

// New function to buy a snippet by hash
export async function buySnippetByHash(hashInput) {
  const hash = hashInput || document.getElementById('buyHashInput').value.trim();
  if (!hash) {
    showToast('Please enter a valid hash.');
    return;
  }
  const result = await buySnippet(hash);
  if (result) {
    showToast('Snippet purchased and displayed below!');
  }
}

async function submitRating(ipHash, rating) {
  const user = auth.currentUser;
  if (!user) return;

  try {
    // Store the user's rating
    const ratingRef = doc(db, 'snippets', ipHash, 'ratings', user.uid);
    await setDoc(ratingRef, {
      rating,
      timestamp: Date.now()
    });

    // Calculate new average rating
    const ratingsSnapshot = await getDocs(collection(db, 'snippets', ipHash, 'ratings'));
    const ratings = ratingsSnapshot.docs.map(doc => doc.data().rating);
    const averageRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;

    // Update the snippet's average rating
    const snippetRef = doc(db, 'snippets', ipHash);
    await updateDoc(snippetRef, {
      averageRating: averageRating.toFixed(1)
    });
  } catch (error) {
    console.error('Failed to submit rating:', error);
    showToast(`Failed to submit rating: ${error.message}`);
  }
}

export async function flagSnippet(ipHash) {
  const user = auth.currentUser;
  if (!user) {
    showToast('Please sign in to flag content.');
    return;
  }

  try {
    const snippetRef = doc(db, 'snippets', ipHash);
    await updateDoc(snippetRef, {
      flagCount: increment(1)
    });

    const snippetSnap = await getDoc(snippetRef);
    const flagCount = snippetSnap.data().flagCount || 0;

    if (flagCount >= 3) {
      await updateDoc(snippetRef, {
        reviewStatus: 'under_review'
      });
      showToast('Snippet has been flagged and is under review.');
      updateLiveFeed();
    } else {
      showToast('Snippet flagged. It will be reviewed if flagged by more users.');
    }
  } catch (error) {
    console.error('Failed to flag snippet:', error);
    showToast(`Failed to flag snippet: ${error.message}`);
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

    const snippetsSnapshot = await getDocs(collection(db, 'snippets'));
    const snippetsData = {};
    snippetsSnapshot.forEach(doc => {
      snippetsData[doc.id] = doc.data();
    });

    dht.knownObjects.forEach((value, key) => {
      const { content_type, description, tags } = value.metadata;
      const queryLower = query.toLowerCase();
      const snippetInfo = snippetsData[key] || { averageRating: 0, reviewStatus: 'active' };

      if (
        snippetInfo.reviewStatus === 'active' &&
        (
          content_type.toLowerCase().includes(queryLower) ||
          (description && description.toLowerCase().includes(queryLower)) ||
          (tags && tags.some(tag => tag.toLowerCase().includes(queryLower)))
        )
      ) {
        const isPremium = value.metadata.isPremium || false;
        const priceUsd = isPremium ? (value.metadata.priceUsd || 0) : 0;
        const costDisplay = priceUsd > 0 ? `${priceUsd} DCT` : 'Free';
        const row = document.createElement('tr');
        row.innerHTML = `
          <td class="py-2 px-4">${content_type}</td>
          <td class="py-2 px-4">${description || 'No description'}</td>
          <td class="py-2 px-4">${tags.join(', ') || 'No tags'}</td>
          <td class="py-2 px-4">${snippetInfo.averageRating} / 5</td>
          <td class="py-2 px-4">
            <button onclick="window.buySnippet('${key}')" class="bg-purple-500 text-white rounded hover:bg-purple-600 px-3 py-1 mr-2">Get (${costDisplay})</button>
            <button onclick="window.flagSnippet('${key}')" class="bg-red-500 text-white rounded hover:bg-red-600 px-3 py-1">Flag</button>
          </td>
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

export async function deposit(amount) {
  if (!isAuthenticated()) {
    showToast('Please sign in to deposit.');
    return;
  }

  showLoading(true);
  try {
    if (!dht) throw new Error('DHT not initialized');
    if (!amount || amount <= 0) throw new Error('Invalid deposit amount');

    const balance = await dht.getBalance(dht.keypair);
    const newBalance = balance + amount;
    await dht.putBalance(dht.keypair, newBalance);
    await dht.dbAdd('transactions', { type: 'deposit', amount, timestamp: Date.now() });

    showToast(`Deposited ${amount} DCT successfully!`);
    updateTransactionHistory();
    updateBalanceDisplay();
    await uploadUserDataToFirebase();
  } catch (error) {
    console.error('deposit failed:', error);
    showToast(`Deposit failed: ${error.message}`);
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
    const balance = dht ? await dht.getBalance(dht.keypair) : 0;
    await setDoc(userRef, {
      balance,
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
  getDocs(collection(db, 'snippets')).then(snippetsSnapshot => {
    const snippetsData = {};
    snippetsSnapshot.forEach(doc => {
      snippetsData[doc.id] = doc.data();
    });

    if (dht) {
      dht.knownObjects.forEach((value, key) => {
        const snippetInfo = snippetsData[key] || { averageRating: 0, reviewStatus: 'active' };
        if (snippetInfo.reviewStatus !== 'active') return; // Skip snippets under review

        const isPremium = value.metadata.isPremium || false;
        const priceUsd = isPremium ? (value.metadata.priceUsd || 0) : 0;
        const costDisplay = priceUsd > 0 ? `${priceUsd} DCT` : 'Free';
        const row = document.createElement('tr');
        row.innerHTML = `
          <td class="py-2 px-4">${value.metadata.content_type}</td>
          <td class="py-2 px-4">${value.metadata.description || 'No description'}</td>
          <td class="py-2 px-4">${value.metadata.tags.join(', ') || 'No tags'}</td>
          <td class="py-2 px-4">${snippetInfo.averageRating} / 5</td>
          <td class="py-2 px-4">
            <button onclick="window.buySnippet('${key}')" class="bg-purple-500 text-white rounded hover:bg-purple-600 px-3 py-1 mr-2">Get (${costDisplay})</button>
            <button onclick="window.flagSnippet('${key}')" class="bg-red-500 text-white rounded hover:bg-red-600 px-3 py-1">Flag</button>
          </td>
        `;
        publishedItemsTableBody.appendChild(row);
      });
    }
  }).catch(error => {
    console.error('Failed to update live feed:', error);
    showToast('Failed to load live feed.');
  });
}

function updateTransactionHistory() {
  const transactionList = document.getElementById('transactionList');
  if (!transactionList) return;

  if (!dht) {
    transactionList.innerHTML = 'Not initialized.';
    return;
  }

  dht.dbGetAll('transactions').then(transactions => {
    if (transactions.length === 0) {
      transactionList.innerHTML = 'No transactions yet.';
      return;
    }

    transactionList.innerHTML = transactions.map(tx => {
      return `<p class="py-1">${tx.type} - ${tx.amount} DCT - ${new Date(tx.timestamp).toLocaleString()}</p>`;
    }).join('');
  }).catch(error => {
    console.error('Failed to update transaction history:', error);
    transactionList.innerHTML = 'Failed to load transactions.';
  });
}

function updateBalanceDisplay() {
  const userBalanceElement = document.getElementById('userBalance');
  if (!userBalanceElement) return;

  if (!dht) {
    userBalanceElement.textContent = 'Balance: 0 DCT';
    userBalance = 0;
    return;
  }

  dht.getBalance(dht.keypair).then(balance => {
    userBalance = balance || 0;
    userBalanceElement.textContent = `Balance: ${userBalance} DCT`;
  }).catch(error => {
    console.error('Failed to update balance:', error);
    userBalanceElement.textContent = 'Balance: 0 DCT';
    userBalance = 0;
  });
}

function updateUIForSignOut() {
  const publishedItemsTableBody = document.getElementById('publishedItems').querySelector('tbody');
  const transactionList = document.getElementById('transactionList');
  const userBalanceElement = document.getElementById('userBalance');

  if (publishedItemsTableBody) publishedItemsTableBody.innerHTML = '';
  if (transactionList) transactionList.innerHTML = 'No transactions yet.';
  if (userBalanceElement) userBalanceElement.textContent = 'Balance: 0 DCT';
  userBalance = 0;
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

// New function to display snippet content after purchase
function displaySnippetContent(data, fileType, title) {
  const snippetDisplay = document.getElementById('snippetDisplay');
  if (!snippetDisplay) return;

  snippetDisplay.innerHTML = ''; // Clear previous content

  const contentDiv = document.createElement('div');
  contentDiv.className = 'p-4 bg-gray-800 rounded-lg mt-4';

  const titleElement = document.createElement('h3');
  titleElement.className = 'text-lg font-semibold mb-2';
  titleElement.textContent = title || 'Snippet Content';
  contentDiv.appendChild(titleElement);

  if (fileType.startsWith('text')) {
    const text = new TextDecoder().decode(data);
    const pre = document.createElement('pre');
    pre.className = 'text-sm text-gray-300 whitespace-pre-wrap';
    pre.textContent = text;
    contentDiv.appendChild(pre);
  } else if (fileType.startsWith('image')) {
    const blob = new Blob([data], { type: fileType });
    const url = URL.createObjectURL(blob);
    const img = document.createElement('img');
    img.src = url;
    img.className = 'max-w-full h-auto rounded';
    img.onload = () => URL.revokeObjectURL(url);
    contentDiv.appendChild(img);
  } else {
    const blob = new Blob([data], { type: fileType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = title || 'downloaded_file';
    a.className = 'text-blue-400 hover:underline';
    a.textContent = 'Download File';
    a.onclick = () => setTimeout(() => URL.revokeObjectURL(url), 1000);
    contentDiv.appendChild(a);
  }

  snippetDisplay.appendChild(contentDiv);
}