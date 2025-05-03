import { db, auth, storage } from './firebase';
import { doc, getDoc, setDoc, updateDoc, increment, getDocs, query, where, collection } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, getStorage } from 'firebase/storage';
import { uint8ArrayToBase64Url } from './dht';

export function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export async function initializeIndexedDB() {
  const TARGET_VERSION = 5;
  return new Promise((resolve, reject) => {
    const checkRequest = indexedDB.open('dcrypt_db');
    checkRequest.onsuccess = () => {
      const db = checkRequest.result;
      const currentVersion = db.version;
      db.close();
      const openRequest = indexedDB.open('dcrypt_db', Math.max(currentVersion, TARGET_VERSION));
      openRequest.onupgradeneeded = () => {
        const db = openRequest.result;
        if (!db.objectStoreNames.contains('store')) db.createObjectStore('store', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('transactions')) db.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains('offlineQueue')) db.createObjectStore('offlineQueue', { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains('chunkCache')) db.createObjectStore('chunkCache', { keyPath: 'id' });
      };
      openRequest.onsuccess = () => resolve(openRequest.result);
      openRequest.onerror = () => reject(new Error(`Failed to open IndexedDB: ${openRequest.error.message}`));
    };
    checkRequest.onerror = () => reject(new Error(`Failed to check IndexedDB version: ${checkRequest.error.message}`));
  });
}

export async function loadKeypair(indexedDB) {
  return new Promise((resolve, reject) => {
    try {
      const tx = indexedDB.transaction('store', 'readonly');
      const store = tx.objectStore('store');
      const request = store.get('dcrypt_identity');
      request.onsuccess = () => resolve(request.result?.value || null);
      request.onerror = () => reject(new Error('Failed to load keypair'));
    } catch (error) {
      reject(error);
    }
  });
}

export async function storeKeypair(indexedDB, userId) {
  return new Promise((resolve, reject) => {
    try {
      const tx = indexedDB.transaction('store', 'readwrite');
      const store = tx.objectStore('store');
      const request = store.put({ id: 'dcrypt_identity', value: userId });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to store keypair'));
    } catch (error) {
      reject(error);
    }
  });
}

export async function checkIfUserIsNode(userId) {
  try {
    const nodeRef = doc(db, 'nodes', userId);
    const nodeSnap = await getDoc(nodeRef);
    return nodeSnap.exists();
  } catch (error) {
    console.error('Failed to check node status:', error);
    return false;
  }
}

export async function uploadProfileImage(userId, file) {
  if (!file) return null;
  try {
    const storageRef = ref(storage, `profile_images/${userId}/${file.name}`);
    await uploadBytes(storageRef, file);
    return await getDownloadURL(storageRef);
  } catch (error) {
    console.error('Failed to upload profile image:', error);
    return null;
  }
}

export async function publishSnippet(title, description, tags, content, fileInput, isPremium, price, dht, user, showToast) {
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
    const metadata = {
      content_type: fileType,
      title,
      description: description || '',
      tags: tags ? tags.split(',').map(t => t.trim()).filter(t => t.length > 0) : [],
      isPremium,
      priceUsd: isPremium ? parseFloat(price) || 0 : 0,
    };
    const ipHash = await dht.publishIP(metadata, finalContent, fileType);
    const userId = auth.currentUser?.uid || localStorage.getItem('nodeId');
    const snippetRef = doc(db, 'snippets', ipHash);
    const snippetData = {
      ipHash,
      title,
      description: description || '',
      tags: metadata.tags,
      isPremium,
      priceUsd: metadata.priceUsd,
      flagCount: 0,
      likes: 0,
      dislikes: 0,
      createdAt: Date.now(),
      creatorId: userId,
    };
    await setDoc(snippetRef, snippetData, { merge: true });
    const userRef = doc(db, 'users', userId);
    await updateDoc(userRef, { snippetsPosted: increment(1) });
    showToast('Snippet published successfully!');
  } catch (error) {
    console.error('publishSnippet failed:', error);
    throw error;
  }
}

export async function updateUserProfile(userId) {
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
          userAvatarElement.innerHTML = `<img src="${userData.profileImageUrl}" alt="Profile Image" class="w-12 h-12 rounded-full object-cover">`;
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

export function displaySnippetContent(data, fileType, title) {
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

export async function copyHash(hash) {
  try {
    await navigator.clipboard.writeText(hash);
    showToast('Hash copied to clipboard!');
  } catch (error) {
    console.error('Failed to copy hash:', error);
    showToast('Failed to copy hash.', true);
  }
}