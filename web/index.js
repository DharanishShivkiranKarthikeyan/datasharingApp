// Import Firebase Auth and Firestore methods
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js';
import { doc, getDoc, setDoc, collection, getDocs, updateDoc, increment } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js';
import { DHT } from './dht.js';
import { createTestPeers } from './testPeers.js';

// Import other JavaScript files to ensure they're included in the bundle
import './signup.js';
import './node-instructions.js';
import './utils.js';

// Global state variables
let auth = null;
let db = null;
let dht = null;
let isNode = false;
let userBalance = 0;
let testPeers = [];
let isSigningUp = false;
let isInitializing = false;

// Initialize Firebase services asynchronously
async function initializeFirebase() {
  console.log('Starting Firebase initialization...');
  try {
    const firebaseModule = await import('./firebase.js');
    auth = firebaseModule.auth;
    db = firebaseModule.db;
    // Set persistence to local to ensure auth state persists across sessions
    await setPersistence(auth, browserLocalPersistence);
    console.log('Firebase services initialized successfully with local persistence');
    console.log('Auth object:', auth);
    console.log('Current Firebase user on init:', auth.currentUser);
  } catch (error) {
    console.error('Failed to initialize Firebase services:', error);
    showToast('Failed to initialize Firebase. Please try again later.', true);
    throw error;
  }
}

// Utility function to generate a UUID
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Check if the user is authenticated
function isAuthenticated() {
  return !!auth?.currentUser || localStorage.getItem('role') === 'node';
}

// Show toast notification
function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = 'toast';
  if (isError) toast.classList.add('error-toast');
  toast.style.display = 'block';
  setTimeout(() => {
    toast.style.display = 'none';
  }, 3000);
}

// Show or hide loading spinner
function showLoading(show) {
  const loading = document.getElementById('loading');
  if (loading) loading.style.display = show ? 'flex' : 'none';
}

// Update UI when user signs out
function updateUIForSignOut() {
  const elements = {
    publishedItemsTableBody: document.getElementById('publishedItems')?.querySelector('tbody'),
    transactionList: document.getElementById('transactionList'),
    userBalanceElement: document.getElementById('userBalance'),
  };

  if (elements.publishedItemsTableBody) elements.publishedItemsTableBody.innerHTML = '';
  if (elements.transactionList) elements.transactionList.innerHTML = 'No transactions yet.';
  if (elements.userBalanceElement) elements.userBalanceElement.textContent = 'Balance: 0 DCT';
  userBalance = 0;
}

// Update balance display
async function updateBalanceDisplay() {
  const userBalanceElement = document.getElementById('userBalance');
  if (!userBalanceElement) return;

  if (!dht) {
    userBalanceElement.textContent = 'Balance: 0 DCT';
    userBalance = 0;
    return;
  }

  try {
    userBalance = (await dht.getBalance(dht.keypair)) || 0;
    userBalanceElement.textContent = `Balance: ${userBalance} DCT`;
  } catch (error) {
    console.error('Failed to update balance:', error);
    userBalanceElement.textContent = 'Balance: 0 DCT';
    userBalance = 0;
  }
}

// Update transaction history display
async function updateTransactionHistory() {
  const transactionList = document.getElementById('transactionList');
  if (!transactionList) return;

  if (!dht) {
    transactionList.innerHTML = 'Not initialized.';
    return;
  }

  try {
    const transactions = await dht.dbGetAll('transactions');
    if (transactions.length === 0) {
      transactionList.innerHTML = 'No transactions yet.';
      return;
    }
    transactionList.innerHTML = transactions
      .map((tx) => `<p class="py-1">${tx.type} - ${tx.amount} DCT - ${new Date(tx.timestamp).toLocaleString()}</p>`)
      .join('');
  } catch (error) {
    console.error('Failed to update transaction history:', error);
    transactionList.innerHTML = 'Failed to load transactions.';
  }
}

// Update the live feed of snippets
async function updateLiveFeed() {
  const publishedItemsTableBody = document.getElementById('publishedItems')?.querySelector('tbody');
  if (!publishedItemsTableBody) return;

  publishedItemsTableBody.innerHTML = '';
  try {
    const snippetsSnapshot = await getDocs(collection(db, 'snippets'));
    const snippetsData = {};
    snippetsSnapshot.forEach((doc) => {
      snippetsData[doc.id] = doc.data();
    });

    if (dht) {
      dht.knownObjects.forEach((value, key) => {
        const snippetInfo = snippetsData[key] || { averageRating: 0, reviewStatus: 'active' };
        if (snippetInfo.reviewStatus !== 'active') return;

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
  } catch (error) {
    console.error('Failed to update live feed:', error);
    showToast('Failed to load live feed.', true);
  }
}

// Upload user data to Firebase
async function uploadUserDataToFirebase() {
  const userId = auth.currentUser?.uid || localStorage.getItem('nodeId');
  if (!userId) return;

  try {
    const userRef = doc(db, 'users', userId);
    const balance = dht ? await dht.getBalance(dht.keypair) : 0;
    await setDoc(userRef, { balance, lastUpdated: Date.now() }, { merge: true });
    console.log('User data uploaded to Firebase');
  } catch (error) {
    console.error('Failed to upload user data to Firebase:', error);
  }
}

// Toggle transaction history visibility
function toggleTransactionHistory() {
  const transactionHistory = document.getElementById('transactionHistory');
  if (transactionHistory) {
    transactionHistory.style.display = transactionHistory.style.display === 'none' ? 'block' : 'none';
  }
}

// Display snippet content after purchase
function displaySnippetContent(data, fileType, title) {
  const snippetDisplay = document.getElementById('snippetDisplay');
  if (!snippetDisplay) return;

  snippetDisplay.innerHTML = '';
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

// Set up premium toggle functionality
function setupPremiumToggle() {
  const premiumToggle = document.getElementById('isPremium');
  const priceInput = document.getElementById('priceInput');
  if (premiumToggle && priceInput) {
    premiumToggle.addEventListener('change', (e) => {
      console.log('Premium toggle:', e.target.checked);
      priceInput.classList.toggle('hidden', !e.target.checked);
      if (!e.target.checked) priceInput.value = '';
    });
  }
}

// Initialize IndexedDB with schema setup for all object stores
async function initializeIndexedDB() {
  const TARGET_VERSION = 4; // Use version 5 consistently across the app
  return new Promise((resolve, reject) => {
    // Open the database without specifying a version to get the current version
    const checkRequest = indexedDB.open('dcrypt_db');

    checkRequest.onsuccess = () => {
      const db = checkRequest.result;
      const currentVersion = db.version;
      console.log('Current IndexedDB version:', currentVersion);
      db.close();

      // Open the database at the target version (or higher if needed)
      const openRequest = indexedDB.open('dcrypt_db', Math.max(currentVersion, TARGET_VERSION));

      openRequest.onupgradeneeded = (event) => {
        const db = openRequest.result;
        console.log('onupgradeneeded triggered for dcrypt_db version', db.version);
        // Create all required object stores
        if (!db.objectStoreNames.contains('store')) {
          db.createObjectStore('store', { keyPath: 'id' });
          console.log('Created object store: store in index.js');
        }
        if (!db.objectStoreNames.contains('transactions')) {
          db.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true });
          console.log('Created object store: transactions in index.js');
        }
        if (!db.objectStoreNames.contains('offlineQueue')) {
          db.createObjectStore('offlineQueue', { keyPath: 'id', autoIncrement: true });
          console.log('Created object store: offlineQueue in index.js');
        }
        if (!db.objectStoreNames.contains('chunkCache')) {
          db.createObjectStore('chunkCache', { keyPath: 'id' });
          console.log('Created object store: chunkCache in index.js');
        }
      };

      openRequest.onsuccess = () => {
        console.log('IndexedDB opened successfully at version', openRequest.result.version);
        resolve(openRequest.result);
      };

      openRequest.onerror = () => {
        console.error('Failed to open IndexedDB:', openRequest.error);
        reject(new Error(`Failed to open IndexedDB: ${openRequest.error.message}`));
      };
    };

    checkRequest.onerror = () => {
      console.error('Failed to check IndexedDB version:', checkRequest.error);
      reject(new Error(`Failed to check IndexedDB version: ${checkRequest.error.message}`));
    };
  });
}

// Load keypair from IndexedDB
async function loadKeypair(indexedDB) {
  return new Promise((resolve, reject) => {
    try {
      const tx = indexedDB.transaction('store', 'readonly');
      const store = tx.objectStore('store');
      const request = store.get('dcrypt_identity');

      request.onsuccess = () => {
        if (request.result?.value) {
          console.log('Loaded keypair from IndexedDB:', request.result.value);
          resolve(new TextEncoder().encode(request.result.value));
        } else {
          resolve(null);
        }
      };

      request.onerror = () => {
        console.error('Failed to load keypair from IndexedDB:', request.error);
        reject(new Error('Failed to load keypair from IndexedDB'));
      };
    } catch (error) {
      console.error('Error accessing "store" object store:', error);
      reject(error);
    }
  });
}

// Store keypair in IndexedDB
async function storeKeypair(indexedDB, userId) {
  return new Promise((resolve, reject) => {
    try {
      const tx = indexedDB.transaction('store', 'readwrite');
      const store = tx.objectStore('store');
      const request = store.put({ id: 'dcrypt_identity', value: userId });

      request.onsuccess = () => {
        console.log('Stored keypair in IndexedDB:', userId);
        resolve();
      };

      request.onerror = () => {
        console.error('Failed to store keypair in IndexedDB:', request.error);
        reject(new Error('Failed to store keypair in IndexedDB'));
      };
    } catch (error) {
      console.error('Error storing keypair in "store" object store:', error);
      reject(error);
    }
  });
}

// Initialize the app
async function init(userId) {
  if (isInitializing) {
    console.log('Initialization already in progress, skipping...');
    return;
  }
  isInitializing = true;
  console.log('Initializing app with userId:', userId);
  showLoading(true);
  try {
    // Initialize IndexedDB
    const indexedDB = await initializeIndexedDB();

    // Load or store keypair
    let keypair = await loadKeypair(indexedDB);
    if (!keypair && userId) {
      await storeKeypair(indexedDB, userId);
      keypair = new TextEncoder().encode(userId);
    }
    if (!keypair) {
      throw new Error('No keypair available and no userId provided to create one');
    }

    // Check if user is a node
    isNode = await checkIfUserIsNode(userId);
    console.log(`User is ${isNode ? '' : 'not '}a node.`);


    // Initialize DHT with the IndexedDB instance
    console.log('Initializing DHT...');
    dht = new DHT(keypair, isNode, indexedDB); // Pass the IndexedDB instance to DHT
    window.dht = dht;

    // Load initial data (identity, offline queue, transactions)
    await Promise.all([
      dht.loadIdentity(),
      dht.loadOfflineQueue(),
      dht.loadTransactions(),
    ]);
    console.log('DHT initial data loaded.');

    await dht.initSwarm();
    console.log('DHT swarm initialized.');

    await dht.syncUserData();
    console.log('User data synced.');

    // Update UI
    await Promise.all([
      updateLiveFeed(),
      updateBalanceDisplay(),
      updateTransactionHistory(),
    ]);
    console.log('UI updated.');
  } catch (error) {
    console.error('Error initializing application:', error);
    showToast(`Initialization failed: ${error.message}`, true);
    dht = null;
    window.dht = null;
    userBalance = 0;
    updateUIForSignOut();
  } finally {
    showLoading(false);
    setupPremiumToggle();
    isInitializing = false;
  }
}

// Check if the user is a node
async function checkIfUserIsNode(userId) {
  try {
    const nodeRef = doc(db, 'nodes', userId);
    const nodeSnap = await getDoc(nodeRef);
    return nodeSnap.exists();
  } catch (error) {
    console.error('Failed to check node status:', error);
    return false;
  }
}

// Handle signup process (sets the role and triggers Google Sign-In)
async function handleSignup() {
  console.log('handleSignup function called');
  if (isSigningUp) {
    console.log('Signup already in progress, ignoring additional clicks');
    return;
  }

  isSigningUp = true;
  const signupButton = document.getElementById('signupButton');
  if (signupButton) {
    signupButton.disabled = true;
    signupButton.textContent = 'Signing Up...';
    console.log('Signup button disabled and text updated');
  }

  const roleInputs = document.querySelectorAll('input[name="role"]');
  if (!roleInputs.length) {
    console.error('Role inputs not found');
    showToast('Role selection not found.', true);
    isSigningUp = false;
    if (signupButton) {
      signupButton.disabled = false;
      signupButton.textContent = 'Sign Up with Google';
    }
    return;
  }

  const role = Array.from(roleInputs).find((input) => input.checked)?.value;
  if (!role) {
    console.error('No role selected');
    showToast('Please select a role.', true);
    isSigningUp = false;
    if (signupButton) {
      signupButton.disabled = false;
      signupButton.textContent = 'Sign Up with Google';
    }
    return;
  }

  console.log('Selected role:', role);
  localStorage.setItem('pendingRole', role);

  try {
    console.log('Auth state before signInWithPopup in handleSignup:', auth);
    const provider = new GoogleAuthProvider();
    console.log('Initiating signInWithPopup for signup');
    const result = await signInWithPopup(auth, provider);
    console.log('Sign-up successful, user:', result.user);
  } catch (error) {
    console.error('Signup failed:', error);
    showToast(`Sign-up failed: ${error.message}`, true);
    isSigningUp = false;
    if (signupButton) {
      signupButton.disabled = false;
      signupButton.textContent = 'Sign Up with Google';
    }
  }
}

// Trigger Google Sign-In
async function signIn() {
  console.log('signIn function called');
  try {
    if (!auth) {
      console.error('Firebase Auth is not initialized, initializing now...');
      await initializeFirebase();
    }
    console.log('Auth state before signInWithPopup:', auth);
    const provider = new GoogleAuthProvider();
    console.log('Initiating signInWithPopup');
    showLoading(true);
    const result = await signInWithPopup(auth, provider);
    console.log('Sign-in successful, user:', result.user);
  } catch (error) {
    console.error('Login failed:', error);
    showToast(`Login failed: ${error.message}`, true);
    showLoading(false);
  }
}

// Sign out the user
async function signOutUser() {
  console.log('signOutUser function called');
  try {
    if (localStorage.getItem('role') === 'node') {
      localStorage.removeItem('nodeId');
      localStorage.removeItem('role');
      showToast('Node signed out successfully!');
    } else {
      await signOut(auth);
      showToast('Signed out successfully!');
    }

    // Clear IndexedDB keypair
    const indexedDB = await initializeIndexedDB();
    const tx = indexedDB.transaction('store', 'readwrite');
    const store = tx.objectStore('store');
    await new Promise((resolve, reject) => {
      const request = store.delete('dcrypt_identity');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to delete keypair from IndexedDB'));
    });

    dht = null;
    window.dht = null;
    testPeers = [];
    userBalance = 0;
    updateUIForSignOut();
  } catch (error) {
    console.error('Sign-out failed:', error);
    showToast(`Sign-out failed: ${error.message}`, true);
  }
}

// Publish a snippet
async function publishSnippet(title, description, tags, content, fileInput) {
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
    if (fileInput?.files?.length) {
      const file = fileInput.files[0];
      fileType = file.type || 'application/octet-stream';
      finalContent = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(new Uint8Array(e.target.result));
        reader.onerror = () => reject(new Error('Failed to read file'));
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
      tags: tags ? tags.split(',').map((t) => t.trim()) : [],
      isPremium,
      priceUsd,
    };

    const ipHash = await dht.publishIP(metadata, finalContent, fileType);
    const userId = auth.currentUser?.uid || localStorage.getItem('nodeId');
    const snippetRef = doc(db, 'snippets', ipHash);
    await setDoc(snippetRef, {
      ipHash,
      flagCount: 0,
      averageRating: 0,
      reviewStatus: 'active',
      createdAt: Date.now(),
      creatorId: userId,
    }, { merge: true });

    showToast('Snippet published successfully!');
    await Promise.all([
      updateLiveFeed(),
      updateTransactionHistory(),
      updateBalanceDisplay(),
      uploadUserDataToFirebase(),
    ]);
  } catch (error) {
    console.error('publishSnippet failed:', error);
    showToast(`Publish failed: ${error.message}`, true);
  } finally {
    showLoading(false);
  }
}

// Buy a snippet by hash
async function buySnippet(hash) {
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
    const buyCost = priceUsd;

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

    await Promise.all([
      updateTransactionHistory(),
      updateBalanceDisplay(),
      uploadUserDataToFirebase(),
    ]);

    const rating = prompt('Please rate this snippet (1-5 stars):', '5');
    if (rating !== null) {
      const ratingValue = parseInt(rating);
      if (ratingValue >= 1 && ratingValue <= 5) {
        await submitRating(hash, ratingValue);
        showToast(`Rated ${ratingValue} stars!`);
        await updateLiveFeed();
      } else {
        showToast('Invalid rating. Please enter a number between 1 and 5.', true);
      }
    }

    displaySnippetContent(data, fileType, ipObject.metadata.content_type);
    return { data, fileType };
  } catch (error) {
    console.error('buySnippet failed:', error);
    showToast(`Purchase failed: ${error.message}`, true);
    return null;
  } finally {
    showLoading(false);
  }
}

// Buy a snippet by hash input
async function buySnippetByHash(hashInput) {
  const hash = hashInput || document.getElementById('buyHashInput')?.value.trim();
  if (!hash) {
    showToast('Please enter a valid hash.', true);
    return;
  }
  const result = await buySnippet(hash);
  if (result) showToast('Snippet purchased and displayed below!');
}

// Submit a rating for a snippet
async function submitRating(ipHash, rating) {
  const userId = auth.currentUser?.uid || localStorage.getItem('nodeId');
  if (!userId) return;

  try {
    const ratingRef = doc(db, 'snippets', ipHash, 'ratings', userId);
    await setDoc(ratingRef, { rating, timestamp: Date.now() });

    const ratingsSnapshot = await getDocs(collection(db, 'snippets', ipHash, 'ratings'));
    const ratings = ratingsSnapshot.docs.map((doc) => doc.data().rating);
    const averageRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;

    const snippetRef = doc(db, 'snippets', ipHash);
    await updateDoc(snippetRef, { averageRating: averageRating.toFixed(1) });
  } catch (error) {
    console.error('Failed to submit rating:', error);
    showToast(`Failed to submit rating: ${error.message}`, true);
  }
}

// Flag a snippet for moderation
async function flagSnippet(ipHash) {
  const userId = auth.currentUser?.uid || localStorage.getItem('nodeId');
  if (!userId) {
    showToast('Please sign in to flag content.');
    return;
  }

  try {
    const snippetRef = doc(db, 'snippets', ipHash);
    await updateDoc(snippetRef, { flagCount: increment(1) });

    const snippetSnap = await getDoc(snippetRef);
    const flagCount = snippetSnap.data().flagCount || 0;

    if (flagCount >= 3) {
      await updateDoc(snippetRef, { reviewStatus: 'under_review' });
      showToast('Snippet has been flagged and is under review.');
      await updateLiveFeed();
    } else {
      showToast('Snippet flagged. It will be reviewed if flagged by more users.');
    }
  } catch (error) {
    console.error('Failed to flag snippet:', error);
    showToast(`Failed to flag snippet: ${error.message}`, true);
  }
}

// Search for snippets
async function searchSnippets(query) {
  if (!isAuthenticated()) {
    showToast('Please sign in to search.');
    return;
  }

  showLoading(true);
  try {
    if (!dht) throw new Error('DHT not initialized');
    if (!query) throw new Error('Search query is required');

    console.log('Starting search with query:', query);
    const publishedItemsTableBody = document.getElementById('publishedItems').querySelector('tbody');
    publishedItemsTableBody.innerHTML = '';

    const snippetsSnapshot = await getDocs(collection(db, 'snippets'));
    const snippetsData = {};
    snippetsSnapshot.forEach((doc) => {
      snippetsData[doc.id] = doc.data();
    });

    let foundResults = false;
    const queryLower = query.toLowerCase();
    dht.knownObjects.forEach((value, key) => {
      const { content_type, description, tags } = value.metadata;
      const snippetInfo = snippetsData[key] || { averageRating: 0, reviewStatus: 'active' };

      if (
        snippetInfo.reviewStatus === 'active' &&
        (
          content_type.toLowerCase().includes(queryLower) ||
          (description && description.toLowerCase().includes(queryLower)) ||
          (tags && tags.some((tag) => tag.toLowerCase().includes(queryLower)))
        )
      ) {
        foundResults = true;
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

    showToast(foundResults ? 'Search completed!' : 'No snippets found matching your search.');
  } catch (error) {
    console.error('searchSnippets failed:', error);
    showToast(`Search failed: ${error.message}`, true);
  } finally {
    showLoading(false);
  }
}

// Deposit funds
async function deposit(amount) {
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
    await Promise.all([
      updateTransactionHistory(),
      updateBalanceDisplay(),
      uploadUserDataToFirebase(),
    ]);
  } catch (error) {
    console.error('deposit failed:', error);
    showToast(`Deposit failed: ${error.message}`, true);
  } finally {
    showLoading(false);
  }
}

// Withdraw funds
async function withdraw(amount) {
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
    await Promise.all([
      updateTransactionHistory(),
      updateBalanceDisplay(),
      uploadUserDataToFirebase(),
    ]);
  } catch (error) {
    console.error('withdraw failed:', error);
    showToast(`Withdrawal failed: ${error.message}`, true);
  } finally {
    showLoading(false);
  }
}

// Main DOMContentLoaded event handler
document.addEventListener('DOMContentLoaded', async () => {
  console.log('DOMContentLoaded event fired');
  console.log('Current pathname:', window.location.pathname);

  // Initialize Firebase
  try {
    await initializeFirebase();
  } catch (error) {
    console.error('Firebase initialization failed, aborting setup:', error);
    showToast('Firebase initialization failed. Please check your configuration.', true);
    return;
  }

  // Check for node redirect
  const role = localStorage.getItem('role');
  const nodeId = localStorage.getItem('nodeId');
  const isIndexPage = window.location.pathname.includes('index.html') || window.location.pathname === '/' || window.location.pathname === '/datasharingApp/';
  if (isIndexPage && role === 'node' && nodeId) {
    console.log('Node detected on index.html, redirecting to node-instructions.html');
    window.location.href = '/datasharingApp/node-instructions.html';
    return;
  }

  // Get DOM elements for index.html
  const elements = {
    signupButton: document.getElementById('signupButton'),
    loginButton: document.getElementById('loginButton'),
    logoutButton: document.getElementById('logoutButton'),
    userBalanceElement: document.getElementById('userBalance'),
    publishButton: document.getElementById('publishButton'),
    searchButton: document.getElementById('searchButton'),
    depositButton: document.getElementById('depositButton'),
    withdrawButton: document.getElementById('withdrawButton'),
    toggleHistoryButton: document.getElementById('toggleHistoryButton'),
    transactionHistory: document.getElementById('transactionHistory'),
    publishedItemsTableBody: document.getElementById('publishedItems')?.querySelector('tbody'),
    buyHashButton: document.getElementById('buyHashButton'),
  };

  // Check if we're on index.html
  const isOnIndexPage = Object.values(elements).some((el) => el !== null && el !== undefined);
  if (isOnIndexPage) {
    console.log('On index.html, setting up UI and event listeners');

    if (role === 'node' && nodeId) {
      isNode = true;
      console.log('Node detected, but should have been redirected already.');
    }

    // Update UI based on authentication state
    onAuthStateChanged(auth, async (user) => {
      console.log('onAuthStateChanged triggered');
      showLoading(true);
      if (user) {
        console.log('User is signed in:', user.uid);
        elements.signupButton?.classList.add('hidden');
        elements.loginButton?.classList.add('hidden');
        elements.logoutButton?.classList.remove('hidden');
        elements.publishButton.disabled = false;
        elements.searchButton.disabled = false;
        elements.depositButton.disabled = false;
        elements.withdrawButton.disabled = false;
        elements.toggleHistoryButton.disabled = false;
        elements.buyHashButton.disabled = false;

        const pendingRole = localStorage.getItem('pendingRole') || 'user';
        localStorage.removeItem('pendingRole');

        const currentPath = window.location.pathname;
        if (pendingRole === 'user') {
          const userRef = doc(db, 'users', user.uid);
          await setDoc(userRef, { role: 'user', createdAt: Date.now(), balance: 0 }, { merge: true });

          if (!currentPath.includes('index.html') && currentPath !== '/datasharingApp/') {
            console.log('Redirecting to index.html for user role');
            window.location.href = '/datasharingApp/index.html';
            showLoading(false);
            return;
          }
        } else {
          const nodeId = generateUUID();
          localStorage.setItem('nodeId', nodeId);
          localStorage.setItem('role', 'node');
          const nodeRef = doc(db, 'nodes', nodeId);
          await setDoc(nodeRef, { role: 'node', createdAt: Date.now(), status: 'active' }, { merge: true });

          if (!currentPath.includes('node-instructions.html')) {
            console.log('Redirecting to node-instructions.html for node role');
            window.location.href = '/datasharingApp/node-instructions.html';
            showLoading(false);
            return;
          }
        }

        await init(user.uid);
      } else {
        console.log('No user is signed in. Checking IndexedDB for keypair...');
        try {
          const indexedDB = await initializeIndexedDB();
          const keypair = await loadKeypair(indexedDB);
          if (keypair) {
            console.log('Found keypair in IndexedDB, initializing app...');
            elements.signupButton?.classList.add('hidden');
            elements.loginButton?.classList.add('hidden');
            elements.logoutButton?.classList.remove('hidden');
            elements.publishButton.disabled = false;
            elements.searchButton.disabled = false;
            elements.depositButton.disabled = false;
            elements.withdrawButton.disabled = false;
            elements.toggleHistoryButton.disabled = false;
            elements.buyHashButton.disabled = false;
            await init(new TextDecoder().decode(keypair));
          } else {
            console.log('No keypair found in IndexedDB.');
            elements.signupButton?.classList.remove('hidden');
            elements.loginButton?.classList.remove('hidden');
            elements.logoutButton?.classList.add('hidden');
            elements.publishButton.disabled = true;
            elements.searchButton.disabled = true;
            elements.depositButton.disabled = true;
            elements.withdrawButton.disabled = true;
            elements.toggleHistoryButton.disabled = true;
            elements.buyHashButton.disabled = true;
            updateUIForSignOut();
          }
        } catch (error) {
          console.error('Failed to initialize IndexedDB or load keypair:', error);
          elements.signupButton?.classList.remove('hidden');
          elements.loginButton?.classList.remove('hidden');
          elements.logoutButton?.classList.add('hidden');
          elements.publishButton.disabled = true;
          elements.searchButton.disabled = true;
          elements.depositButton.disabled = true;
          elements.withdrawButton.disabled = true;
          elements.toggleHistoryButton.disabled = true;
          elements.buyHashButton.disabled = true;
          updateUIForSignOut();
        }
      }
      showLoading(false);
    }, (error) => {
      console.error('onAuthStateChanged error:', error);
      showToast('Failed to monitor authentication state.', true);
      showLoading(false);
    });

    // Set up event listeners
    elements.loginButton?.addEventListener('click', (event) => {
      event.preventDefault();
      console.log('Login button clicked');
      signIn();
    });

    elements.logoutButton?.addEventListener('click', (event) => {
      event.preventDefault();
      console.log('Logout button clicked');
      signOutUser();
    });
  } else {
    console.log('Not on index.html, skipping index.html-specific setup');
  }

  // Expose functions to the global scope
  window.logout = signOutUser;
  window.publishSnippet = publishSnippet;
  window.buySnippet = buySnippet;
  window.buySnippetByHash = buySnippetByHash;
  window.searchSnippets = searchSnippets;
  window.deposit = deposit;
  window.withdraw = withdraw;
  window.toggleTransactionHistory = toggleTransactionHistory;
  window.flagSnippet = flagSnippet;
  window.handleSignup = handleSignup;
});