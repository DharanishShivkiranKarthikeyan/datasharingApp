// Import Firebase Auth and Firestore methods
import { GoogleAuthProvider, onAuthStateChanged, signInWithRedirect, signOut } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js';
import { doc, getDoc, setDoc, collection, getDocs, updateDoc, increment } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js';
import { DHT } from './dht.js';
import { createTestPeers } from './testPeers.js';

// Import other JavaScript files to ensure they're included in the bundle
import './signup.js';
import './node-instructions.js';
import './sw.js';
import './utils.js';

// Global state variables
let auth = null;
let db = null;
let dht = null;
let isNode = false;
let userBalance = 0;
let testPeers = [];
let isSigningUp = false;

// Initialize Firebase services asynchronously
async function initializeFirebase() {
  try {
    const firebaseModule = await import('./firebase.js');
    auth = firebaseModule.auth;
    db = firebaseModule.db;
    console.log('Firebase services initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Firebase services:', error);
    showToast('Failed to initialize Firebase. Please try again later.', true);
    throw error; // Re-throw to handle in the caller
  }
}

// Wait for the DOM to load before accessing elements
document.addEventListener('DOMContentLoaded', async () => {
  console.log('DOMContentLoaded event fired');
  console.log('Current pathname:', window.location.pathname);

  // Initialize Firebase before proceeding
  try {
    await initializeFirebase();
  } catch (error) {
    console.error('Firebase initialization failed, aborting setup:', error);
    return; // Stop execution if Firebase fails to initialize
  }

  // Check if the user is a node and redirect if on index.html
  const role = localStorage.getItem('role');
  const nodeId = localStorage.getItem('nodeId');
  const isIndexPage = window.location.pathname.includes('index.html') || window.location.pathname === '/' || window.location.pathname === '/datasharingApp/';
  if (isIndexPage && role === 'node' && nodeId) {
    console.log('Node detected on index.html, redirecting to node-instructions.html');
    window.location.href = '/datasharingApp/node-instructions.html';
    return;
  }

  // Get DOM elements for index.html
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
  const publishedItemsTableBody = document.getElementById('publishedItems')?.querySelector('tbody');
  const buyHashButton = document.getElementById('buyHashButton');

  // Check if we're on index.html by verifying the presence of required elements
  const isOnIndexPage = signupButton && loginButton && logoutButton && userBalanceElement && publishButton && searchButton && depositButton && withdrawButton && toggleHistoryButton && transactionHistory && publishedItemsTableBody && buyHashButton;

  if (isOnIndexPage) {
    console.log('On index.html, setting up UI and event listeners');

    // Check if the user is a node based on localStorage
    if (role === 'node' && nodeId) {
      isNode = true;
      console.log('Node detected, but should have been redirected already.');
    }

    // Update UI based on Firebase authentication state
    console.log('Setting up onAuthStateChanged listener');
    onAuthStateChanged(auth, async (user) => {
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
        buyHashButton.disabled = false;

        // Handle role-based logic after sign-in
        const pendingRole = localStorage.getItem('pendingRole') || 'user';
        localStorage.removeItem('pendingRole'); // Clear immediately to avoid persistence

        // Determine the current page
        const currentPath = window.location.pathname;

        if (pendingRole === 'user') {
          // Store user data in Firestore
          const userRef = doc(db, 'users', user.uid);
          await setDoc(userRef, {
            role: 'user',
            createdAt: Date.now(),
            balance: 0
          }, { merge: true });

          // Only redirect if not already on index.html
          if (!currentPath.includes('index.html') && currentPath !== '/datasharingApp/') {
            console.log('Redirecting to index.html for user role');
            window.location.href = '/datasharingApp/index.html';
            return; // Exit to prevent further execution until redirect
          }
        } else {
          // Store node data in Firestore
          const nodeId = generateUUID();
          localStorage.setItem('nodeId', nodeId);
          localStorage.setItem('role', 'node');
          const nodeRef = doc(db, 'nodes', nodeId);
          await setDoc(nodeRef, {
            role: 'node',
            createdAt: Date.now(),
            status: 'active'
          }, { merge: true });

          // Only redirect if not already on node-instructions.html
          if (!currentPath.includes('node-instructions.html')) {
            console.log('Redirecting to node-instructions.html for node role');
            window.location.href = '/datasharingApp/node-instructions.html';
            return; // Exit to prevent further execution until redirect
          }
        }

        // Initialize the app if no redirect is needed
        await init(user.uid);
      } else {
        console.log('No user is signed in. Checking IndexedDB for keypair...');
        const dbRequest = indexedDB.open('dcrypt_db', 3);
        dbRequest.onsuccess = async () => {
          const db = dbRequest.result;
          const tx = db.transaction('store', 'readonly');
          const store = tx.objectStore('store');
          const request = store.get('dcrypt_identity');
          request.onsuccess = async () => {
            if (request.result && request.result.value) {
              const keypair = new TextEncoder().encode(request.result.value);
              console.log('Found keypair in IndexedDB, initializing app...');
              signupButton.classList.add('hidden');
              loginButton.classList.add('hidden');
              logoutButton.classList.remove('hidden');
              publishButton.disabled = false;
              searchButton.disabled = false;
              depositButton.disabled = false;
              withdrawButton.disabled = false;
              toggleHistoryButton.disabled = false;
              buyHashButton.disabled = false;
              await init(request.result.value);
            } else {
              console.log('No keypair found in IndexedDB.');
              signupButton.classList.remove('hidden');
              loginButton.classList.remove('hidden');
              logoutButton.classList.add('hidden');
              publishButton.disabled = true;
              searchButton.disabled = true;
              depositButton.disabled = true;
              withdrawButton.disabled = true;
              toggleHistoryButton.disabled = true;
              buyHashButton.disabled = true;
              updateUIForSignOut();
            }
          };
          request.onerror = () => {
            console.error('Failed to load keypair from IndexedDB');
            signupButton.classList.remove('hidden');
            loginButton.classList.remove('hidden');
            logoutButton.classList.add('hidden');
            publishButton.disabled = true;
            searchButton.disabled = true;
            depositButton.disabled = true;
            withdrawButton.disabled = true;
            toggleHistoryButton.disabled = true;
            buyHashButton.disabled = true;
            updateUIForSignOut();
          };
        };
        dbRequest.onerror = () => {
          console.error('Failed to open IndexedDB');
          signupButton.classList.remove('hidden');
          loginButton.classList.remove('hidden');
          logoutButton.classList.add('hidden');
          publishButton.disabled = true;
          searchButton.disabled = true;
          depositButton.disabled = true;
          withdrawButton.disabled = true;
          toggleHistoryButton.disabled = true;
          buyHashButton.disabled = true;
          updateUIForSignOut();
        };
      }
    }, (error) => {
      console.error('onAuthStateChanged error:', error);
      showToast('Failed to monitor authentication state.', true);
    });

    // Set up event listeners for index.html buttons
    console.log('Attaching event listener to loginButton');
    loginButton.addEventListener('click', (event) => {
      event.preventDefault();
      console.log('Login button clicked');
      signIn();
    });

    console.log('Attaching event listener to logoutButton');
    logoutButton.addEventListener('click', (event) => {
      event.preventDefault();
      console.log('Logout button clicked');
      signOutUser();
    });
  } else {
    console.log('Not on index.html, skipping index.html-specific setup');
  }

  // Expose functions to the global scope for HTML onclick handlers
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

// Utility function to generate a UUID
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Handle signup process (sets the role and triggers Google Sign-In)
export async function handleSignup() {
  console.log('handleSignup function called');
  if (isSigningUp) {
    console.log('Signup already in progress, ignoring additional clicks');
    return;
  }

  isSigningUp = true;
  const signupButton = document.getElementById("signupButton");
  if (signupButton) {
    signupButton.disabled = true;
    signupButton.textContent = 'Signing Up...';
    console.log('Signup button disabled and text updated');
  } else {
    console.warn('Signup button not found');
  }

  const roleInputs = document.querySelectorAll('input[name="role"]');
  if (!roleInputs || roleInputs.length === 0) {
    console.error('Role inputs not found');
    showToast('Role selection not found.', true);
    isSigningUp = false;
    if (signupButton) {
      signupButton.disabled = false;
      signupButton.textContent = 'Sign Up with Google';
    }
    return;
  }

  const role = Array.from(roleInputs).find(input => input.checked)?.value;
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
    const provider = new GoogleAuthProvider();
    console.log('GoogleAuthProvider created');
    console.log('Initiating signInWithRedirect for signup');
    await signInWithRedirect(auth, provider);
    console.log('signInWithRedirect completed for signup'); // This won't log due to redirect
  } catch (error) {
    console.error('Handling user signup with OAuth...');
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
export async function signIn() {
  console.log('signIn function called');
  try {
    if (!auth) {
      console.error('Firebase Auth is not initialized');
      throw new Error('Firebase Auth is not initialized');
    }
    const provider = new GoogleAuthProvider();
    console.log('GoogleAuthProvider created for signIn');
    console.log('Initiating signInWithRedirect');
    await signInWithRedirect(auth, provider);
    console.log('signInWithRedirect completed'); // This won't log due to redirect
  } catch (error) {
    console.error('Handling user login with OAuth...');
    console.error('Login failed:', error);
    showToast(`Login failed: ${error.message}`, true);
  }
}

// Sign out the user
export async function signOutUser() {
  console.log('signOutUser function called');
  try {
    if (localStorage.getItem('role') === 'node') {
      // Clear node data from localStorage
      localStorage.removeItem('nodeId');
      localStorage.removeItem('role');
      showToast('Node signed out successfully!');
    } else {
      await signOut(auth);
      showToast('Signed out successfully!');
    }
    // Clear IndexedDB keypair
    const dbRequest = indexedDB.open('dcrypt_db', 3);
    dbRequest.onsuccess = () => {
      const db = dbRequest.result;
      const tx = db.transaction('store', 'readwrite');
      const store = tx.objectStore('store');
      store.delete('dcrypt_identity');
    };
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

// Check if the user is authenticated
export function isAuthenticated() {
  return !!auth.currentUser || localStorage.getItem('role') === 'node';
}

// Publish a snippet
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
    const userId = auth.currentUser?.uid || localStorage.getItem('nodeId');
    const snippetRef = doc(db, 'snippets', ipHash);
    await setDoc(snippetRef, {
      ipHash,
      flagCount: 0,
      averageRating: 0,
      reviewStatus: 'active',
      createdAt: Date.now(),
      creatorId: userId
    }, { merge: true });

    showToast('Snippet published successfully!');
    updateLiveFeed();
    updateTransactionHistory();
    updateBalanceDisplay();
    await uploadUserDataToFirebase();
  } catch (error) {
    console.error('publishSnippet failed:', error);
    showToast(`Publish failed: ${error.message}`, true);
  } finally {
    showLoading(false);
  }
}

// Buy a snippet by hash
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
        updateLiveFeed();
      } else {
        showToast('Invalid rating. Please enter a number between 1 and 5.', true);
      }
    }

    // Display the snippet content
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
export async function buySnippetByHash(hashInput) {
  const hash = hashInput || document.getElementById('buyHashInput').value.trim();
  if (!hash) {
    showToast('Please enter a valid hash.',true);
    return;
  }
  const result = await buySnippet(hash);
  if (result) {
    showToast('Snippet purchased and displayed below!');
  }
}

// Submit a rating for a snippet
async function submitRating(ipHash, rating) {
  const userId = auth.currentUser?.uid || localStorage.getItem('nodeId');
  if (!userId) return;

  try {
    const ratingRef = doc(db, 'snippets', ipHash, 'ratings', userId);
    await setDoc(ratingRef, {
      rating,
      timestamp: Date.now()
    });

    const ratingsSnapshot = await getDocs(collection(db, 'snippets', ipHash, 'ratings'));
    const ratings = ratingsSnapshot.docs.map(doc => doc.data().rating);
    const averageRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;

    const snippetRef = doc(db, 'snippets', ipHash);
    await updateDoc(snippetRef, {
      averageRating: averageRating.toFixed(1)
    });
  } catch (error) {
    console.error('Failed to submit rating:', error);
    showToast(`Failed to submit rating: ${error.message}`, true);
  }
}

// Flag a snippet for moderation
export async function flagSnippet(ipHash) {
  const userId = auth.currentUser?.uid || localStorage.getItem('nodeId');
  if (!userId) {
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
    showToast(`Failed to flag snippet: ${error.message}`, true);
  }
}

// Search for snippets
export async function searchSnippets(query) {
  if (!isAuthenticated()) {
    showToast('Please sign in to search.');
    return;
  }

  showLoading(true);
  try {
    if (!dht) throw new Error('DHT not initialized');
    if (!query) throw new Error('Search query is required');

    console.log('Starting search with query:', query);
    console.log('dht.knownObjects size:', dht.knownObjects.size);
    console.log('dht.knownObjects:', Array.from(dht.knownObjects.entries()));

    const publishedItemsTableBody = document.getElementById('publishedItems').querySelector('tbody');
    publishedItemsTableBody.innerHTML = '';

    const snippetsSnapshot = await getDocs(collection(db, 'snippets'));
    const snippetsData = {};
    snippetsSnapshot.forEach(doc => {
      snippetsData[doc.id] = doc.data();
    });
    console.log('Snippets from Firestore:', snippetsData);

    let foundResults = false;
    dht.knownObjects.forEach((value, key) => {
      const { content_type, description, tags } = value.metadata;
      const queryLower = query.toLowerCase();
      const snippetInfo = snippetsData[key] || { averageRating: 0, reviewStatus: 'active' };

      console.log(`Checking snippet ${key}:`, { content_type, description, tags, reviewStatus: snippetInfo.reviewStatus });

      if (
        snippetInfo.reviewStatus === 'active' &&
        (
          content_type.toLowerCase().includes(queryLower) ||
          (description && description.toLowerCase().includes(queryLower)) ||
          (tags && tags.some(tag => tag.toLowerCase().includes(queryLower)))
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
        console.log(`Found matching snippet ${key}`);
      }
    });

    if (!foundResults) {
      showToast('No snippets found matching your search.');
    } else {
      showToast('Search completed!');
    }
  } catch (error) {
    console.error('searchSnippets failed:', error);
    showToast(`Search failed: ${error.message}`, true);
  } finally {
    showLoading(false);
  }
}

// Deposit funds
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
    showToast(`Deposit failed: ${error.message}`, true);
  } finally {
    showLoading(false);
  }
}

// Withdraw funds
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
    showToast(`Withdrawal failed: ${error.message}`, true);
  } finally {
    showLoading(false);
  }
}

// Toggle transaction history visibility
export function toggleTransactionHistory() {
  const transactionHistory = document.getElementById('transactionHistory');
  if (transactionHistory) {
    transactionHistory.style.display = transactionHistory.style.display === 'none' ? 'block' : 'none';
  }
}

// Upload user data to Firebase
async function uploadUserDataToFirebase() {
  const userId = auth.currentUser?.uid || localStorage.getItem('nodeId');
  if (!userId) return;

  try {
    const userRef = doc(db, 'users', userId);
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

// Update the live feed of snippets
function updateLiveFeed() {
  const publishedItemsTableBody = document.getElementById('publishedItems')?.querySelector('tbody');
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
  }).catch(error => {
    console.error('Failed to update live feed:', error);
    showToast('Failed to load live feed.', true);
  });
}

// Update transaction history display
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

// Update balance display
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

// Update UI when user signs out
function updateUIForSignOut() {
  const publishedItemsTableBody = document.getElementById('publishedItems')?.querySelector('tbody');
  const transactionList = document.getElementById('transactionList');
  const userBalanceElement = document.getElementById('userBalance');

  if (publishedItemsTableBody) publishedItemsTableBody.innerHTML = '';
  if (transactionList) transactionList.innerHTML = 'No transactions yet.';
  if (userBalanceElement) userBalanceElement.textContent = 'Balance: 0 DCT';
  userBalance = 0;
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

// Set up premium toggle functionality
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

// Initialize the app
export async function init(userId) {
  console.log('Initializing app...');
  showLoading(true);
  try {
    let keypair;
    const dbRequest = indexedDB.open('dcrypt_db', 3);
    await new Promise((resolve, reject) => {
      dbRequest.onsuccess = () => {
        const db = dbRequest.result;
        const tx = db.transaction('store', 'readonly');
        const store = tx.objectStore('store');
        const request = store.get('dcrypt_identity');
        request.onsuccess = () => {
          if (request.result && request.result.value) {
            keypair = new TextEncoder().encode(request.result.value);
            console.log('Loaded keypair from IndexedDB:', request.result.value);
          } else if (userId) {
            keypair = new TextEncoder().encode(userId);
            // Store the keypair in IndexedDB for future auto sign-in
            const txWrite = db.transaction('store', 'readwrite');
            const storeWrite = txWrite.objectStore('store');
            storeWrite.put({ id: 'dcrypt_identity', value: userId });
          } else {
            reject(new Error('No user ID or stored keypair found'));
            return;
          }
          resolve();
        };
        request.onerror = () => reject(new Error('Failed to load keypair from IndexedDB'));
      };
      dbRequest.onerror = () => reject(new Error('Failed to open IndexedDB'));
    });

    if (!isNode) {
      isNode = await checkIfUserIsNode(userId);
    }
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
    showToast(`Initialization failed: ${error.message}`, true);
    dht = null;
    window.dht = null;
    userBalance = 0;
    updateUIForSignOut();
  } finally {
    showLoading(false);
    setupPremiumToggle();
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