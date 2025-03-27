import { auth, db } from './firebase.js';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js';
import { doc, getDoc, setDoc, collection, getDocs, updateDoc, increment, arrayUnion, arrayRemove } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js';
import { DHT } from './dht.js';

import './signup.js';
import './node-instructions.js';
import './sw.js';
import './utils.js';

let dht = null;
let isNode = false;
let userBalance = 0;
let currentChatPeerId = null;
let currentChatUsername = null;
let currentChatType = 'direct';
let currentGroupId = null;
let currentGroupParticipants = [];
let currentGroupUsernames = {};

document.addEventListener('DOMContentLoaded', () => {
  const role = localStorage.getItem('role');
  const nodeId = localStorage.getItem('nodeId');
  const path = window.location.pathname;
  const isIndexPage = path.includes('index.html') || path === '/datasharingApp/' || path === '/datasharingApp';
  if (isIndexPage && role === 'node' && nodeId) {
    console.log('Node detected on index page, redirecting to node-instructions.html');
    window.location.href = '/datasharingApp/node-instructions.html';
    return;
  }

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
  const chatContacts = document.getElementById('chatContacts');
  const chatWindow = document.getElementById('chatWindow');
  const chatInput = document.getElementById('chatInput');
  const sendChatButton = document.getElementById('sendChatButton');
  const createGroupButton = document.getElementById('createGroupButton');
  const chatList = document.getElementById('chatList');
  const inviteButton = document.getElementById('inviteButton');
  const leaveGroupButton = document.getElementById('leaveGroupButton');

  if (isIndexPage) {
    if (!signupButton || !loginButton || !logoutButton || !userBalanceElement || !publishButton || !searchButton || !depositButton || !withdrawButton || !toggleHistoryButton || !transactionHistory || !publishedItemsTableBody || !buyHashButton || !chatContacts || !chatWindow || !chatInput || !sendChatButton || !createGroupButton || !chatList) {
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
        publishedItemsTableBody: !!publishedItemsTableBody,
        buyHashButton: !!buyHashButton,
        chatContacts: !!chatContacts,
        chatWindow: !!chatWindow,
        chatInput: !!chatInput,
        sendChatButton: !!sendChatButton,
        createGroupButton: !!createGroupButton,
        chatList: !!chatList
      });
      return;
    }

    if (role === 'node' && nodeId) {
      isNode = true;
      console.log('Node detected, but should have been redirected already.');
    } else {
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
          buyHashButton.disabled = false;
          sendChatButton.disabled = false;
          createGroupButton.disabled = false;
          init(user.uid);
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
          buyHashButton.disabled = true;
          sendChatButton.disabled = true;
          createGroupButton.disabled = true;
          updateUIForSignOut();
        }
      });
    }

    loginButton.addEventListener('click', signIn);
    console.log('Login button event listener attached');
    logoutButton.addEventListener('click', signOutUser);
    sendChatButton.addEventListener('click', sendDirectMessage);
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendDirectMessage();
    });
    createGroupButton.addEventListener('click', createGroupChat);
    if (inviteButton) inviteButton.addEventListener('click', inviteToGroup);
    if (leaveGroupButton) leaveGroupButton.addEventListener('click', leaveGroup);
    loadGroupChats();

    if (window.userDirectory) {
      window.userDirectory.forEach(contact => {
        if (contact.peerId !== dht?.peer?.id) {
          const li = document.createElement('li');
          li.className = 'p-2 bg-gray-600 rounded cursor-pointer hover:bg-gray-500';
          li.textContent = `${contact.username} (${contact.type})`;
          li.onclick = () => startDirectChat(contact.peerId, contact.username);
          chatContacts.appendChild(li);
        }
      });
    }
  }

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
  window.showDirectChats = showDirectChats;
});

export function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export async function handleSignup() {
  const roleInputs = document.querySelectorAll('input[name="role"]');
  if (!roleInputs) {
    showToast('Role selection not found.', true);
    return;
  }

  const role = Array.from(roleInputs).find(input => input.checked)?.value;
  if (!role) {
    showToast('Please select a role.', true);
    return;
  }

  const username = prompt('Please enter your username:');
  if (!username || username.trim() === '') {
    showToast('Username is required.', true);
    return;
  }

  showLoading(true);
  try {
    if (role === 'user') {
      console.log("Handling user signup with OAuth...");
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
      console.log('Signed in user UID:', user.uid);
      showToast('Signed in successfully!');

      const userRef = doc(db, 'users', user.uid);
      await setDoc(userRef, {
        role: 'user',
        createdAt: Date.now(),
        username: username.trim()
      }, { merge: true });

      window.location.href = '/datasharingApp/index.html';
    } else {
      console.log("Handling node signup without OAuth...");
      const nodeId = generateUUID();
      console.log('Generated node ID:', nodeId);

      localStorage.setItem('nodeId', nodeId);
      localStorage.setItem('role', 'node');

      const nodeRef = doc(db, 'nodes', nodeId);
      await setDoc(nodeRef, {
        role: 'node',
        createdAt: Date.now(),
        username: username.trim()
      }, { merge: true });

      showToast('Node created successfully!');
      window.location.href = '/datasharingApp/node-instructions.html';
    }
  } catch (error) {
    console.error('Signup failed:', error);
    showToast(`Signup failed: ${error.message}`, true);
  } finally {
    showLoading(false);
  }
}

export async function init(userId) {
  console.log('Initializing app...');
  showLoading(true);
  try {
    const encoder = new TextEncoder();
    const keypair = encoder.encode(userId);

    if (!isNode) {
      isNode = await checkIfUserIsNode(userId);
    }
    console.log(`User is ${isNode ? '' : 'not '}a node.`);

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

    const userDirectory = await fetchUserDirectory();
    console.log('User directory:', userDirectory);
    window.userDirectory = userDirectory;

    const chatContacts = document.getElementById('chatContacts');
    chatContacts.innerHTML = '';
    userDirectory.forEach(contact => {
      if (contact.peerId !== dht.peer.id) {
        const li = document.createElement('li');
        li.className = 'p-2 bg-gray-600 rounded cursor-pointer hover:bg-gray-500';
        li.textContent = `${contact.username} (${contact.type})`;
        li.onclick = () => startDirectChat(contact.peerId, contact.username);
        chatContacts.appendChild(li);
      }
    });
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

export async function signIn() {
  console.log('signIn function called');
  const provider = new GoogleAuthProvider();
  try {
    console.log('Attempting signInWithPopup');
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    console.log('Signed in user UID:', user.uid);
    showToast('Signed in successfully!');
    await init(user.uid);
  } catch (error) {
    console.error('Sign-in failed:', error);
    showToast(`Sign-in failed: ${error.message}`, true);
  }
}

export async function signOutUser() {
  try {
    if (localStorage.getItem('role') === 'node') {
      localStorage.removeItem('nodeId');
      localStorage.removeItem('role');
      showToast('Node signed out successfully!');
    } else {
      await signOut(auth);
      showToast('Signed out successfully!');
    }
    dht = null;
    window.dht = null;
    userBalance = 0;
    updateUIForSignOut();
  } catch (error) {
    console.error('Sign-out failed:', error);
    showToast(`Sign-out failed: ${error.message}`, true);
  }
}

export function isAuthenticated() {
  return !!auth.currentUser || localStorage.getItem('role') === 'node';
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

export async function buySnippetByHash(hashInput) {
  const hash = hashInput || document.getElementById('buyHashInput').value.trim();
  if (!hash) {
    showToast('Please enter a valid hash.', true);
    return;
  }
  const result = await buySnippet(hash);
  if (result) {
    showToast('Snippet purchased and displayed below!');
  }
}

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

export function toggleTransactionHistory() {
  const transactionHistory = document.getElementById('transactionHistory');
  if (transactionHistory.style.display === 'none') {
    transactionHistory.style.display = 'block';
  } else {
    transactionHistory.style.display = 'none';
  }
}

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
  const publishedItemsTableBody = document.getElementById('publishedItems')?.querySelector('tbody');
  const transactionList = document.getElementById('transactionList');
  const userBalanceElement = document.getElementById('userBalance');
  const chatWindow = document.getElementById('chatWindow');
  const chatContacts = document.getElementById('chatContacts');

  if (publishedItemsTableBody) publishedItemsTableBody.innerHTML = '';
  if (transactionList) transactionList.innerHTML = 'No transactions yet.';
  if (userBalanceElement) userBalanceElement.textContent = 'Balance: 0 DCT';
  if (chatWindow) chatWindow.innerHTML = '';
  if (chatContacts) chatContacts.innerHTML = '';
  userBalance = 0;
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

async function fetchUserDirectory() {
  const usersSnapshot = await getDocs(collection(db, 'users'));
  const nodesSnapshot = await getDocs(collection(db, 'nodes'));
  const users = usersSnapshot.docs.map(doc => ({
    id: doc.id,
    type: 'user',
    peerId: `user-${doc.id}`,
    username: doc.data().username || 'Anonymous',
    ...doc.data()
  }));
  const nodes = nodesSnapshot.docs.map(doc => ({
    id: doc.id,
    type: 'node',
    peerId: `node-${doc.id}`,
    username: doc.data().username || 'Anonymous',
    ...doc.data()
  }));
  return [...users, ...nodes];
}

async function createGroupChat() {
  const groupName = prompt('Enter group name:');
  if (!groupName) return;

  const groupId = generateUUID();
  const peerId = dht.peer.id;
  const userId = auth.currentUser?.uid || localStorage.getItem('nodeId');
  const userDoc = await getDoc(doc(db, peerId.startsWith('user-') ? 'users' : 'nodes', userId));
  const username = userDoc.exists() ? userDoc.data().username : 'Anonymous';

  await setDoc(doc(db, 'chat_groups', groupId), {
    name: groupName,
    participants: [peerId],
    participantIds: [userId],
    participantUsernames: [username],
    createdAt: Date.now()
  });
  showToast('Group created successfully!');
  loadGroupChats();
}

async function loadGroupChats() {
  const chatList = document.getElementById('chatList');
  while (chatList.children.length > 1) {
    chatList.removeChild(chatList.lastChild);
  }

  const groupChatsSnapshot = await getDocs(collection(db, 'chat_groups'));
  groupChatsSnapshot.forEach(doc => {
    const group = doc.data();
    const li = document.createElement('li');
    li.className = 'p-2 bg-gray-600 rounded cursor-pointer hover:bg-gray-500';
    li.textContent = `Group: ${group.name} (${group.participants.length} members)`;
    li.onclick = () => startGroupChat(doc.id, group.name, group.participants, group.participantUsernames);
    chatList.appendChild(li);
  });
}

async function startGroupChat(groupId, groupName, participants, participantUsernames) {
  currentChatType = 'group';
  currentChatPeerId = null;
  currentGroupId = groupId;
  currentGroupParticipants = participants;
  currentGroupUsernames = participantUsernames.reduce((acc, username, index) => {
    acc[participants[index]] = username;
    return acc;
  }, {});
  const chatId = `group-${groupId}`;
  const chatWindow = document.getElementById('chatWindow');
  const inviteButton = document.getElementById('inviteButton');
  const leaveGroupButton = document.getElementById('leaveGroupButton');
  chatWindow.innerHTML = `<h3>${groupName}</h3><p>Members: ${participantUsernames.join(', ')}</p>`;
  if (inviteButton) inviteButton.classList.remove('hidden');
  if (leaveGroupButton) leaveGroupButton.classList.remove('hidden');

  const messages = await dht.getChatMessages(chatId);
  messages.forEach(displayChatMessage);

  dht.onChatMessage(chatId, (message) => {
    displayChatMessage(message);
  });

  if (!participants.includes(dht.peer.id)) {
    const userId = auth.currentUser?.uid || localStorage.getItem('nodeId');
    const userDoc = await getDoc(doc(db, dht.peer.id.startsWith('user-') ? 'users' : 'nodes', userId));
    const username = userDoc.exists() ? userDoc.data().username : 'Anonymous';
    await updateDoc(doc(db, 'chat_groups', groupId), {
      participants: arrayUnion(dht.peer.id),
      participantIds: arrayUnion(userId),
      participantUsernames: arrayUnion(username)
    });
    currentGroupParticipants.push(dht.peer.id);
    currentGroupUsernames[dht.peer.id] = username;
  }
}

async function startDirectChat(peerId, username) {
  currentChatType = 'direct';
  currentChatPeerId = peerId;
  currentChatUsername = username;
  currentGroupId = null;
  currentGroupParticipants = [];
  currentGroupUsernames = {};
  const chatId = `direct-${peerId}`;
  const chatWindow = document.getElementById('chatWindow');
  const inviteButton = document.getElementById('inviteButton');
  const leaveGroupButton = document.getElementById('leaveGroupButton');
  chatWindow.innerHTML = `<h3>Chat with ${username}</h3>`;
  if (inviteButton) inviteButton.classList.add('hidden');
  if (leaveGroupButton) leaveGroupButton.classList.add('hidden');

  const messages = await dht.getChatMessages(chatId);
  messages.forEach(displayChatMessage);

  dht.onChatMessage(chatId, (message) => {
    displayChatMessage(message);
  });
}

async function sendDirectMessage() {
  const chatInput = document.getElementById('chatInput');
  const message = chatInput.value.trim();
  if (!message) return;

  const userId = auth.currentUser?.uid || localStorage.getItem('nodeId');
  const userDoc = await getDoc(doc(db, dht.peer.id.startsWith('user-') ? 'users' : 'nodes', userId));
  const username = userDoc.exists() ? userDoc.data().username : 'Anonymous';

  if (currentChatType === 'direct' && currentChatPeerId) {
    await dht.sendChatMessage(currentChatPeerId, message, 'direct', null, username);
  } else if (currentChatType === 'group' && currentGroupId) {
    for (const peerId of currentGroupParticipants) {
      if (peerId !== dht.peer.id) {
        await dht.sendChatMessage(peerId, message, 'group', currentGroupId, username);
      }
    }
  }
  chatInput.value = '';
}

function displayChatMessage(message) {
  const chatWindow = document.getElementById('chatWindow');
  const messageDiv = document.createElement('div');
  messageDiv.className = 'mb-2';
  const fromSelf = message.from === dht.peer.id;
  messageDiv.className += fromSelf ? ' text-right' : ' text-left';
  const senderUsername = message.username || (fromSelf ? 'You' : currentChatUsername || currentGroupUsernames[message.from]) || 'Anonymous';
  messageDiv.innerHTML = `<span class="${fromSelf ? 'text-blue-300' : 'text-green-300'}">${senderUsername}</span>: ${message.message}`;
  chatWindow.appendChild(messageDiv);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function showDirectChats() {
  currentChatType = 'direct';
  currentGroupId = null;
  currentGroupParticipants = [];
  currentGroupUsernames = {};
  const chatContacts = document.getElementById('chatContacts');
  const chatWindow = document.getElementById('chatWindow');
  const inviteButton = document.getElementById('inviteButton');
  const leaveGroupButton = document.getElementById('leaveGroupButton');
  chatContacts.classList.remove('hidden');
  chatWindow.innerHTML = '';
  if (inviteButton) inviteButton.classList.add('hidden');
  if (leaveGroupButton) leaveGroupButton.classList.add('hidden');
}

async function inviteToGroup() {
  if (currentChatType !== 'group' || !currentGroupId) return;

  const usernameToInvite = prompt('Enter the username to invite:');
  if (!usernameToInvite) return;

  const userDirectory = await fetchUserDirectory();
  const userToInvite = userDirectory.find(user => user.username === usernameToInvite);
  if (!userToInvite) {
    showToast('User not found.', true);
    return;
  }

  const groupDoc = await getDoc(doc(db, 'chat_groups', currentGroupId));
  if (!groupDoc.exists()) return;

  const groupData = groupDoc.data();
  if (groupData.participants.includes(userToInvite.peerId)) {
    showToast('User is already in the group.', true);
    return;
  }

  await updateDoc(doc(db, 'chat_groups', currentGroupId), {
    participants: arrayUnion(userToInvite.peerId),
    participantIds: arrayUnion(userToInvite.id),
    participantUsernames: arrayUnion(userToInvite.username)
  });

  currentGroupParticipants.push(userToInvite.peerId);
  currentGroupUsernames[userToInvite.peerId] = userToInvite.username;
  showToast(`Invited ${usernameToInvite} to the group!`);
  startGroupChat(currentGroupId, groupData.name, [...groupData.participants, userToInvite.peerId], [...groupData.participantUsernames, userToInvite.username]);
}

async function leaveGroup() {
  if (currentChatType !== 'group' || !currentGroupId) return;

  const peerId = dht.peer.id;
  const userId = auth.currentUser?.uid || localStorage.getItem('nodeId');
  const userDoc = await getDoc(doc(db, peerId.startsWith('user-') ? 'users' : 'nodes', userId));
  const username = userDoc.exists() ? userDoc.data().username : 'Anonymous';

  await updateDoc(doc(db, 'chat_groups', currentGroupId), {
    participants: arrayRemove(peerId),
    participantIds: arrayRemove(userId),
    participantUsernames: arrayRemove(username)
  });

  showToast('You have left the group.');
  showDirectChats();
  loadGroupChats();
}