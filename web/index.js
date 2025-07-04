import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js';
import { doc, getDoc, setDoc, collection, getDocs, updateDoc, increment, query, where, onSnapshot } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js';
import { ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-storage.js';
import { DHT } from './dht.js';
import { uint8ArrayToBase64Url } from './dht.js';

import './utils.js';

let auth = null;
let db = null;
let storage = null;
let dht = null;
let isNode = false;
let userBalance = 0;
let isSigningUp = false;
let isInitializing = false;

async function initializeFirebase() {
  console.log('Starting Firebase initialization...');
  try {
    const firebaseModule = await import('./firebase.js');
    auth = firebaseModule.auth;
    db = firebaseModule.db;
    storage = firebaseModule.storage;
    await setPersistence(auth, browserLocalPersistence);
    console.log('Firebase services initialized successfully with local persistence');
  } catch (error) {
    console.error('Failed to initialize Firebase services:', error);
    showToast('Failed to initialize Firebase. Please try again later.', true);
    throw error;
  }
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function isAuthenticated() {
  return !!auth?.currentUser || localStorage.getItem('role') === 'node';
}

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

function redirectToPublish() {
  if (!isAuthenticated() || !dht) {
    showToast('Please sign in and ensure the app is initialized before publishing.', true);
    return;
  }

  try {
    const modal = document.getElementById('publishModal');
    modal.classList.add('active');
    console.log('Opened publish modal');
  } catch (error) {
    console.error('Failed to open publish modal:', error);
    showToast('Failed to open publish modal. Please try again.', true);
  }
}

async function openBuyModal(hash) {
  if (!isAuthenticated() || !dht) {
    showToast('Please sign in and ensure the app is initialized before viewing.', true);
    return;
  }

  try {
    const ipObject = await dht.getIPmetadata(hash);
    console.log(ipObject)
    if (!ipObject) throw new Error('Snippet not found');

    window.currentProduct = hash;
    const modal = document.getElementById('buyModal');
    document.getElementById('snippetTitle').value = ipObject.title || 'Untitled';
    document.getElementById('snippetDescription').value = ipObject.description || 'No description';
    document.getElementById('snippetPrice').value = ipObject.isPremium ? `${ipObject.priceUsd} DCT` : 'Free';
    modal.classList.add('active');
  } catch (error) {
    console.error('Failed to open buy/preview modal:', error);
    showToast('Failed to open buy/preview modal. Please try again.', true);
  }
}

function updateUIForSignOut() {
  const elements = {
    snippetGallery: document.getElementById('snippetGallery'),
    mySnippetsTableBody: document.getElementById('mySnippets')?.querySelector('tbody'),
    transactionList: document.getElementById('transactionList'),
    userBalanceElement: document.getElementById('userBalance'),
    userNameElement: document.getElementById('userName'),
    userAvatarElement: document.querySelector('.user-avatar'),
    snippetsPostedElement: document.getElementById('snippetsPosted'),
  };

  if (elements.snippetGallery) elements.snippetGallery.innerHTML = '';
  if (elements.mySnippetsTableBody) elements.mySnippetsTableBody.innerHTML = '';
  if (elements.transactionList) elements.transactionList.innerHTML = 'No transactions yet.';
  if (elements.userBalanceElement) elements.userBalanceElement.textContent = 'Balance: 0 DCT';
  if (elements.userNameElement) elements.userNameElement.textContent = 'Guest User';
  if (elements.userAvatarElement) {
    elements.userAvatarElement.innerHTML = '<i class="fas fa-user text-lg"></i>';
  }
  if (elements.snippetsPostedElement) elements.snippetsPostedElement.textContent = '0';
  userBalance = 0;

  localStorage.removeItem('userKeypair');
  localStorage.removeItem('peerId');
  localStorage.removeItem('dhtInitialized');
  console.log('Cleared persisted state from localStorage on sign-out');
}

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

async function updateSnippetGallery() {
  const snippetGallery = document.getElementById('snippetGallery');
  if (!snippetGallery) return;

  snippetGallery.innerHTML = '';
  try {
    if (!dht.hasActiveConnections) {
      console.log("no node connections yet!")
      return;
    }

    const ipObjects = await dht.getIPmetadata('all');
    if (!ipObjects || ipObjects.length === 0) {
      snippetGallery.innerHTML = '<p>No snippets available.</p>';
      return;
    }

    ipObjects.slice(0, 50).forEach(({ hash, metadata }) => {
      const card = document.createElement('div');
      let image = new Image();
      image.src = `data:image/png;base64,${metadata.coverImage}`;
      card.className = 'bg-gray-800 rounded-lg overflow-hidden shadow-lg';
      card.innerHTML = `
        <img src="${`data:image/png;base64,${metadata.coverImage}`}" alt="Cover Image" class="w-full h-48 object-cover">
        <div class="p-4">
          <h3 class="text-lg font-semibold">${metadata.title || 'Untitled'}</h3>
          <p class="text-sm text-gray-400">${metadata.tags.join(', ') || 'No tags'}</p>
          <div class="mt-2 flex justify-between">
            <button onclick="window.openBuyModal('${hash}')" class="btn btn-primary">Get (${metadata.isPremium ? `${metadata.priceUsd} DCT` : 'Free'})</button>
            <button onclick="window.flagSnippet('${hash}')" class="btn btn-danger">Flag</button>
          </div>
        </div>
      `;
      snippetGallery.appendChild(card);
    });
  } catch (error) {
    console.error('Failed to update snippet gallery:', error);
    showToast('Failed to load snippets.', true);
  }
}

async function updateMySnippets() {
  const mySnippetsTableBody = document.getElementById('mySnippets')?.querySelector('tbody');
  if (!mySnippetsTableBody) return;

  mySnippetsTableBody.innerHTML = '';
  try {
    const userId = auth.currentUser?.uid || localStorage.getItem('nodeId');
    if (!userId) return;

    const snippetsQuery = query(collection(db, 'snippets'), where('creatorId', '==', userId));
    const snippetsSnapshot = await getDocs(snippetsQuery);
    snippetsSnapshot.forEach((doc) => {
      const data = doc.data();
      const row = document.createElement('tr');
      row.innerHTML = `
        <td class="py-2 px-4">${data.title || 'No title'}</td>
        <td class="py-2 px-4">${data.ipHash}</td>
        <td class="py-2 px-4">
          <button onclick="window.copyHash('${data.ipHash}')" class="btn btn-primary text-white px-3 py-1">Copy Hash</button>
        </td>
      `;
      mySnippetsTableBody.appendChild(row);
    });
  } catch (error) {
    console.error('Failed to update my snippets:', error);
    showToast('Failed to load your snippets.', true);
  }
}

async function searchSnippets(searchTerm) {
  const snippetGallery = document.getElementById('snippetGallery');
  if (!snippetGallery) return;

  snippetGallery.innerHTML = '';
  try {
    if (!dht || !dht.hasActiveConnections) {
      showToast('Waiting for node connection to search snippets...', false);
      return;
    }

    const ipObjects = await dht.getIPmetadata('all');
    if (!ipObjects || ipObjects.length === 0) {
      snippetGallery.innerHTML = '<p>No snippets available.</p>';
      return;
    }

    const searchTags = searchTerm.split(',').map(tag => tag.trim().toLowerCase()).filter(tag => tag);
    ipObjects.slice(0, 50).forEach(({ hash, metadata }) => {
      const tags = (metadata.tags || []).map(tag => tag.toLowerCase());
      if (searchTags.length > 0 && !searchTags.some(tag => tags.includes(tag))) return;

      const card = document.createElement('div');
      card.className = 'bg-gray-800 rounded-lg overflow-hidden shadow-lg';
      card.innerHTML = `
        <img src="${metadata.coverImage || 'default-cover.jpg'}" alt="Cover Image" class="w-full h-48 object-cover">
        <div class="p-4">
          <h3 class="text-lg font-semibold">${metadata.title || 'Untitled'}</h3>
          <p class="text-sm text-gray-400">${metadata.tags.join(', ') || 'No tags'}</p>
          <div class="mt-2 flex justify-between">
            <button onclick="window.openBuyModal('${hash}')" class="btn btn-primary">Get (${metadata.isPremium ? `${metadata.priceUsd} DCT` : 'Free'})</button>
            <button onclick="window.flagSnippet('${hash}')" class="btn btn-danger">Flag</button>
          </div>
        </div>
      `;
      snippetGallery.appendChild(card);
    });
  } catch (error) {
    console.error('Failed to search snippets:', error);
    showToast('Search failed.', true);
  }
}

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

function toggleTransactionHistory() {
  const transactionHistory = document.getElementById('transactionHistory');
  if (transactionHistory) {
    transactionHistory.style.display = transactionHistory.style.display === 'none' ? 'block' : 'none';
  }
}

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

async function initializeIndexedDB() {
  const TARGET_VERSION = 5;
  return new Promise((resolve, reject) => {
    console.log('Starting IndexedDB initialization...');
    const checkRequest = indexedDB.open('dcrypt_db');

    checkRequest.onsuccess = () => {
      const db = checkRequest.result;
      const currentVersion = db.version;
      console.log('Current IndexedDB version:', currentVersion);
      db.close();

      const openRequest = indexedDB.open('dcrypt_db', Math.max(currentVersion, TARGET_VERSION));

      openRequest.onupgradeneeded = (event) => {
        const db = openRequest.result;
        console.log('Upgrading database to version', TARGET_VERSION);
        if (!db.objectStoreNames.contains('store')) {
          db.createObjectStore('store', { keyPath: 'id' });
          console.log('Created object store: store');
        }
        if (!db.objectStoreNames.contains('transactions')) {
          db.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true });
          console.log('Created object store: transactions');
        }
        if (!db.objectStoreNames.contains('offlineQueue')) {
          db.createObjectStore('offlineQueue', { keyPath: 'id', autoIncrement: true });
          console.log('Created object store: offlineQueue');
        }
        if (!db.objectStoreNames.contains('chunkCache')) {
          db.createObjectStore('chunkCache', { keyPath: 'id' });
          console.log('Created object store: chunkCache');
        }
        console.log('Database upgrade completed');
      };

      openRequest.onsuccess = () => {
        const db = openRequest.result;
        console.log('IndexedDB opened successfully at version', db.version);
        resolve(db);
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

async function loadKeypair(indexedDB) {
  return new Promise((resolve, reject) => {
    try {
      const tx = indexedDB.transaction('store', 'readonly');
      const store = tx.objectStore('store');
      const request = store.get('dcrypt_identity');

      request.onsuccess = () => {
        const value = request.result?.value;
        if (value && typeof value === 'string') {
          console.log('Loaded keypair from IndexedDB:', value);
          resolve(value);
        } else {
          console.log('No valid keypair found in IndexedDB.');
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

async function storeKeypair(indexedDB, userId) {
  return new Promise((resolve, reject) => {
    try {
      console.log('Storing keypair in IndexedDB:', userId);
      const tx = indexedDB.transaction('store', 'readwrite');
      const store = tx.objectStore('store');
      const request = store.put({ id: 'dcrypt_identity', value: userId });

      request.onsuccess = () => {
        console.log('Successfully stored keypair in IndexedDB');
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

async function init(userId, indexedDB) {
  if (isInitializing) {
    console.log('Initialization already in progress, skipping...');
    return;
  }
  isInitializing = true;
  console.log('Initializing app with userId:', userId);
  try {
    if (!indexedDB) {
      indexedDB = await initializeIndexedDB();
    }
    let keypair = await loadKeypair(indexedDB);
    if (keypair instanceof Uint8Array) {
      keypair = uint8ArrayToBase64Url(keypair);
    }
    if (!keypair && userId) {
      console.log('No keypair found, using userId as keypair:', userId);
      await storeKeypair(indexedDB, userId);
      keypair = userId;
    } else if (!keypair) {
      throw new Error('No keypair available and no userId provided to create one');
    } else if (keypair.length > 40) {
      console.warn('Existing keypair is unusually large:', keypair.length, 'characters. Overwriting with userId.');
      keypair = userId;
      await storeKeypair(indexedDB, userId);
    }

    isNode = await checkIfUserIsNode(userId);
    console.log(`User is ${isNode ? '' : 'not '}a node.`);

    dht = new DHT(keypair, isNode);
    window.dht = dht;

    await dht.initDB();
    console.log('DHT database initialized.');

    await dht.initSwarm();
    console.log('DHT swarm initialized.');

    await dht.syncUserData();
    console.log('User data synced.');

    await Promise.all([
      updateMySnippets(),
      updateBalanceDisplay(),
      updateTransactionHistory()
    ]);
    dht.waitForConnection().then(()=>{
      console.log("done waiting")
      updateSnippetGallery();
    })
    
    console.log('UI updated.');

    await updateUserProfile(userId);
  } catch (error) {
    console.error('Error initializing application:', error);
    if (error.message.includes('ID conflict')) {
      showToast('Failed to connect to the network due to an ID conflict. Please try signing out and signing in again.', true);
    } else {
      showToast(`Initialization failed: ${error.message}`, true);
    }
    if (dht) {
      dht.destroy();
    }
    dht = null;
    window.dht = null;
    userBalance = 0;
    updateUIForSignOut();
  } finally {
    isInitializing = false;
  }
  uploadUserDataToFirebase();
  
}

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

async function handleSignup() {
  console.log('handleSignup function called');
  if (isSigningUp) {
    console.log('Signup already in progress, ignoring additional clicks');
    return;
  }
  localStorage.setItem("visited", "y");

  isSigningUp = true;
  const signupButton = document.getElementById('signupButton');
  if (signupButton) {
    signupButton.disabled = true;
    signupButton.textContent = 'Signing Up...';
    console.log('Signup button disabled and text updated');
  }

  localStorage.setItem('pendingRole', "user");

  try {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    console.log('Sign-up successful, user:', result.user);

    const username = document.getElementById('usernameInput').value;

    const userRef = doc(db, 'users', result.user.uid);
    await setDoc(userRef, {
      username: username || result.user.displayName || 'Anonymous User',
      profileImageUrl: result.user.photoURL,
      createdAt: Date.now(),
      snippetsPosted: 0,
    }, { merge: true });

    console.log('User profile saved to Firestore');
    showToast('Sign-up successful! Redirecting to dashboard...');
    window.location.href = '/datasharingApp/';
  } catch (error) {
    console.error('Signup failed:', error);
    showToast(`Sign-up failed: ${error.message}`, true);
    isSigningUp = false;
    if (signupButton) {
      signupButton.disabled = false;
      signupButton.textContent = 'Sign Up with Google';
    }
  } finally {
    localStorage.removeItem('pendingRole');
  }
}

async function deposit(amount) {
  if (!isAuthenticated()) {
    showToast('Please sign in to deposit.');
    return;
  }

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
  }
}

async function withdraw(amount) {
  if (!isAuthenticated()) {
    showToast('Please sign in to withdraw.');
    return;
  }

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
  }
}

async function signIn() {
  console.log('signIn function called');
  try {
    if (!auth) {
      console.error('Firebase Auth is not initialized, initializing now...');
      await initializeFirebase();
    }
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    console.log('Sign-in successful, user:', result.user);
    if(window.location.pathname.includes("land")){
      window.location.href = '/datasharingApp/'
    }
  } catch (error) {
    console.error('Login failed:', error);
    showToast(`Login failed: ${error.message}`, true);
  }
}

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

    if (dht) {
      dht.destroy();
      dht = null;
      window.dht = null;
    }

    const indexedDB = await initializeIndexedDB();
    const tx = indexedDB.transaction('store', 'readwrite');
    const store = tx.objectStore('store');
    await new Promise((resolve, reject) => {
      const request = store.delete('dcrypt_identity');
      request.onsuccess = () => {
        console.log('Successfully deleted keypair from IndexedDB');
        resolve();
      };
      request.onerror = () => {
        console.error('Failed to delete keypair from IndexedDB:', request.error);
        reject(new Error('Failed to delete keypair from IndexedDB'));
      };
    });

    userBalance = 0;
    updateUIForSignOut();
  } catch (error) {
    console.error('Sign-out failed:', error);
    showToast(`Sign-out failed: ${error.message}`, true);
  }
}

async function publishSnippet(title, description, tags, content, fileInput) {
  if (!isAuthenticated()) {
    showToast('Please sign in to publish.');
    return;
  }

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

    const isPremium = document.getElementById('modalPremium').checked;
    const priceInput = document.getElementById('modalPriceInput');
    const priceUsd = isPremium && priceInput ? parseFloat(priceInput.value) || 0 : 0;
    const coverImageInput = document.getElementById('modalCoverImageInput');

    let coverImageBase64 = '';
    if (coverImageInput?.files?.length) {
      const coverImage = coverImageInput.files[0];
      const reader = new FileReader();
      coverImageBase64 = await new Promise((resolve, reject) => {
        reader.onload = (e) => resolve(e.target.result.split(',')[1]);
        reader.onerror = () => reject(new Error('Failed to read cover image'));
        reader.readAsDataURL(coverImage);
      });
    }

    const metadata = {
      content_type: fileType,
      title: title,
      description: description || '',
      tags: tags ? tags.split(',').map((t) => t.trim()).filter((t) => t.length > 0) : [],
      isPremium: isPremium,
      priceUsd: priceUsd,
      coverImage: coverImageBase64,
    };

    const { ipHash, targetPeer } = await dht.publishIP(metadata, finalContent, fileType);
    const userId = auth.currentUser?.uid || localStorage.getItem('nodeId');
    const snippetRef = doc(db, 'snippets', ipHash);

    const snippetData = {
      ipHash: ipHash,
      title: title,
      description: description || '',
      tags: metadata.tags,
      isPremium: isPremium,
      priceUsd: priceUsd,
      flagCount: 0,
      likes: 0,
      dislikes: 0,
      createdAt: Date.now(),
      creatorId: userId,
      targetNode: targetPeer,
      coverImage: coverImageBase64,
    };
    await setDoc(snippetRef, snippetData, { merge: true });

    const userRef = doc(db, 'users', userId);
    await updateDoc(userRef, {
      snippetsPosted: increment(1)
    });

    showToast('Snippet published successfully!');
    window.closePublishModal();
    await Promise.all([
      updateSnippetGallery(),
      updateMySnippets(),
      updateTransactionHistory(),
      updateBalanceDisplay(),
      uploadUserDataToFirebase(),
      updateUserProfile(userId),
    ]);
  } catch (error) {
    console.error('publishSnippet failed:', error);
  }
}

async function buySnippet(hash) {
  if (!isAuthenticated()) {
    showToast('Please sign in to buy.');
    return null;
  }

  try {
    if (!dht) throw new Error('DHT not initialized');
    if (!hash) throw new Error('Hash is required');
    let ipObject = await dht.getIPmetadata(hash);

    const snippetRef = doc(db, 'snippets', hash);
    const snippetSnap = await getDoc(snippetRef);
    if (!snippetSnap.exists()) throw new Error('Snippet not found');

    const snippet = snippetSnap.data();

    const isPremium = ipObject.isPremium || false;
    const priceUsd = isPremium ? (ipObject.priceUsd || 0) : 0;
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

    const { data, fileType } = await dht.requestData(ipObject, snippet.targetNode, hash);
    showToast('Snippet retrieved successfully!');

    await Promise.all([
      updateTransactionHistory(),
      updateBalanceDisplay(),
      uploadUserDataToFirebase(),
      updateMySnippets(),
    ]);

    const feedback = prompt('Do you like this snippet? Type "like" or "dislike":');
    if (feedback !== null) {
      const action = feedback.trim().toLowerCase();
      if (action === 'like' || action === 'dislike') {
        await submitFeedback(hash, action);
        showToast(`You ${action}d this snippet!`);
        await updateSnippetGallery();
      } else {
        showToast('Invalid input. Please type "like" or "dislike".', true);
      }
    }

    displaySnippetContent(data, fileType, ipObject.title);
    return { data, fileType };
  } catch (error) {
    console.error('buySnippet failed:', error);
    showToast(`Purchase failed: ${error.message}`, true);
    return null;
  }
}

async function buySnippetByHash(hashInput) {
  const hash = hashInput || document.getElementById('buyHashInput')?.value.trim();
  if (!hash) {
    showToast('Please enter a valid hash.', true);
    return;
  }
  const result = await buySnippet(hash);
  if (result) showToast('Snippet purchased and displayed below!');
}

async function submitFeedback(ipHash, action) {
  const userId = auth.currentUser?.uid || localStorage.getItem('nodeId');
  if (!userId) return;

  try {
    const feedbackRef = doc(db, 'snippets', ipHash, 'feedback', userId);
    await setDoc(feedbackRef, { action, timestamp: Date.now() });

    const snippetRef = doc(db, 'snippets', ipHash);
    if (action === 'like') {
      await updateDoc(snippetRef, { likes: increment(1) });
    } else if (action === 'dislike') {
      await updateDoc(snippetRef, { dislikes: increment(1) });
    }
  } catch (error) {
    console.error('Failed to submit feedback:', error);
    showToast(`Failed to submit feedback: ${error.message}`, true);
  }
}

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
      await updateSnippetGallery();
    } else {
      showToast('Snippet flagged. It will be reviewed if flagged by more users.');
    }
  } catch (error) {
    console.error('Failed to flag snippet:', error);
    showToast(`Failed to flag snippet: ${error.message}`, true);
  }
}

async function becomeNode() {
  const nodeId = generateUUID();
  console.log(nodeId);
  localStorage.setItem('nodeId', nodeId);
  localStorage.setItem('role', 'node');
  const nodeRef = doc(db, 'nodes', nodeId);
  await setDoc(nodeRef, { role: 'node', createdAt: Date.now(), status: 'active' }, { merge: true });

  if (!window.location.pathname.includes('node-instructions.html')) {
    console.log('Redirecting to node-instructions.html for node role');
    window.location.href = '/datasharingApp/node-instructions.html';
    return;
  }
}

async function initNode() {
  try {
    const nodeId = localStorage.getItem('nodeId');
    const role = localStorage.getItem('role');
   
    localStorage.removeItem('nodeId');
    localStorage.removeItem('role');
    sessionStorage.setItem('nodeId', nodeId);
    sessionStorage.setItem('role', role);
    console.log("Moved to session storage");
    if (role !== 'node' || !nodeId) {
      showToast('You must be signed in as a node to view this page.');
      window.location.href = '/datasharingApp/signup.html';
      return;
    }

    dht = new DHT(nodeId, true);
    await dht.initDB();
    await dht.initSwarm();
    await dht.syncUserData();

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
  }
}

async function updateUserProfile(userId) {
  if (!userId) return;

  try {
    const userRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      const userData = userSnap.data();
      const userNameElement = document.getElementById('userName');
      const userAvatarElement = document.querySelector('.user-avatar');
      const snippetsPostedElement = document.getElementById('snippetsPosted');

      if (userNameElement) {
        userNameElement.textContent = userData.username || 'Anonymous User';
      }
      if (userAvatarElement) {
        if (userData.profileImageUrl) {
          userAvatarElement.innerHTML = `<img src=${userData.profileImageUrl} alt="Profile Image" class="w-12 h-12 rounded-full object-cover">`;
        } else {
          userAvatarElement.innerHTML = '<i class="fas fa-user text-lg"></i>';
        }
      }
      if (snippetsPostedElement) {
        snippetsPostedElement.textContent = userData.snippetsPosted || 0;
      }
    }
  } catch (error) {
    console.error('Failed to fetch user profile:', error);
    showToast('Failed to load user profile.', true);
  }
}

async function copyHash(hash) {
  try {
    await navigator.clipboard.writeText(hash);
    showToast('Hash copied to clipboard!');
  } catch (error) {
    console.error('Failed to copy hash:', error);
    showToast('Failed to copy hash.', true);
  }
}

function closePublishModal() {
  const modal = document.getElementById('publishModal');
  if (modal) modal.classList.remove('active');
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!(localStorage.getItem("visited") === "y") && !window.location.pathname.includes("signup") && !window.location.pathname.includes("node")) {
    localStorage.setItem("visited","y");
    window.location.href = "/datasharingApp/landing.html";
    const minLoadingTime = new Promise(resolve => setTimeout(resolve, 1000));
    await minLoadingTime;
    
  }
  window.login = signIn;

  console.log('DOMContentLoaded event fired');
  console.log('Current pathname:', window.location.pathname);
  if (window.location.pathname.includes("signup")) {
    const userSignupForm = document.getElementById('userSignupForm');
    if (userSignupForm) {
      userSignupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await window.handleSignup();
      });
    }
  }
  if (window.location.pathname.includes("node")) {
    initNode();
  }
  try {
    await initializeFirebase();
  } catch (error) {
    console.error('Firebase initialization failed, aborting setup:', error);
    showToast('Firebase initialization failed. Please check your configuration.', true);
    return;
  }

  const role = localStorage.getItem('role');
  const nodeId = localStorage.getItem('nodeId');

  const isIndexPage = !(window.location.pathname.includes("node") || window.location.pathname.includes("signup.html") || window.location.pathname.includes("landing"));
  if (isIndexPage && role === 'node' && nodeId) {
    console.log('Node detected on index.html, redirecting to node-instructions.html');
    window.location.href = '/datasharingApp/node-instructions.html';
  }

  if (isIndexPage) {
    document.getElementById("body").classList = [];
    const indexedDB = await initializeIndexedDB();
    const keypair = await loadKeypair(indexedDB);
    try {
      await Promise.all([
        new Promise((resolve) => {
          onAuthStateChanged(auth, async (user) => {
            console.log('onAuthStateChanged triggered');
            if (user) {
              console.log('User is signed in:', user.uid);
              await init(user.uid, indexedDB);
            } else {
              console.log('No user is signed in. Checking IndexedDB for keypair...');
              try {
                if (keypair) {
                  console.log('Found keypair in IndexedDB, initializing app...');
                  await init(keypair, indexedDB);
                } else {
                  console.log('No keypair found in IndexedDB.');
                  if (isIndexPage) {
                    updateUIForSignOut();
                  }
                }
              } catch (error) {
                console.error('Failed to initialize IndexedDB or load keypair:', error);
                if (isIndexPage) {
                  updateUIForSignOut();
                }
              }
            }
            resolve();
          }, (error) => {
            console.error('onAuthStateChanged error:', error);
            showToast('Failed to monitor authentication state.', true);
            resolve();
          });
        }),
      ]);
    } catch (error) {
      console.error('Initialization error:', error);
      showToast('An error occurred during initialization.', true);
    }
  }
  if(window.location.pathname.includes("landing")){
    let loginButton = document.getElementById('loginButton');
    loginButton?.addEventListener('click', (event) => {
      event.preventDefault();
      console.log('Login button clicked');
      signIn();
    });
  }

  if (isIndexPage) {
    var elements = {
      signupButton: document.getElementById('signupButton'),
      loginButton: document.getElementById('loginButton'),
      logoutButton: document.getElementById('logoutButton'),
      userBalanceElement: document.getElementById('userBalance'),
      searchButton: document.getElementById('searchButton'),
      depositButton: document.getElementById('depositButton'),
      withdrawButton: document.getElementById('withdrawButton'),
      toggleHistoryButton: document.getElementById('toggleHistoryButton'),
      transactionHistory: document.getElementById('transactionHistory'),
      snippetGallery: document.getElementById('snippetGallery'),
      buyHashButton: document.getElementById('buyHashButton'),
    };

    console.log('On index.html, setting up UI and event listeners');

    if (role === 'node' && nodeId) {
      isNode = true;
      console.log('Node detected, but should have been redirected already.');
    }

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

    onAuthStateChanged(auth, (user) => {
      if (user) {
        elements.signupButton?.classList.add('hidden');
        elements.loginButton?.classList.add('hidden');
        elements.logoutButton?.classList.remove('hidden');
        elements.searchButton.disabled = false;
        elements.depositButton.disabled = false;
        elements.withdrawButton.disabled = false;
        elements.toggleHistoryButton.disabled = false;
        elements.buyHashButton.disabled = false;
      } else {
        elements.signupButton?.classList.remove('hidden');
        elements.loginButton?.classList.remove('hidden');
        elements.logoutButton?.classList.add('hidden');
        elements.searchButton.disabled = true;
        elements.depositButton.disabled = true;
        elements.withdrawButton.disabled = true;
        elements.toggleHistoryButton.disabled = true;
        elements.buyHashButton.disabled = true;
        updateUIForSignOut();
      }
    });

    const publishForm = document.getElementById('publishForm');
    if (publishForm) {
      publishForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const title = document.getElementById('modalTitleInput').value;
        const description = document.getElementById('modalDescriptionInput').value;
        const tags = document.getElementById('modalTagsInput').value;
        const content = document.getElementById('modalContentInput').value;
        const fileInput = document.getElementById('modalFileInput');
        await window.publishSnippet(title, description, tags, content, fileInput);
      });
    }
  } else {
    console.log('Not on index.html, skipping index.html-specific setup');
  }

  window.logout = signOutUser;
  window.publishSnippet = publishSnippet;
  window.buySnippet = buySnippet;
  window.buySnippetByHash = buySnippetByHash;
  window.toggleTransactionHistory = toggleTransactionHistory;
  window.flagSnippet = flagSnippet;
  window.handleSignup = handleSignup;
  window.becomeNode = becomeNode;
  window.deposit = deposit;
  window.withdraw = withdraw;
  window.redirectToPublish = redirectToPublish;
  window.searchSnippets = searchSnippets;
  window.copyHash = copyHash;
  window.openBuyModal = openBuyModal;
  window.closePublishModal = closePublishModal;
});