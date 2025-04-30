import { useState, useEffect, useCallback } from 'react';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, increment } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useNavigate } from 'react-router-dom';
import { DHT, uint8ArrayToBase64Url } from '@/lib/dht.js'; // Import directly from src/lib/dht.js
import { auth, db } from '@/firebase.js'; // Import directly from src/firebase.js

let storage = null;
let isSigningUp = false;

export const useAuth = () => {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(localStorage.getItem('role'));
  const [nodeId, setNodeId] = useState(localStorage.getItem('nodeId'));
  const [isInitializing, setIsInitializing] = useState(false);
  const navigate = useNavigate();

  const initializeFirebase = useCallback(async () => {
    try {
      storage = getStorage();
      await setPersistence(auth, browserLocalPersistence);
      console.log('Firebase services initialized successfully with local persistence');
    } catch (error) {
      console.error('Failed to initialize Firebase services:', error);
      throw error;
    }
  }, []);

  const isAuthenticated = useCallback(() => {
    return !!auth?.currentUser || localStorage.getItem('role') === 'node';
  }, []);

  const signIn = useCallback(async () => {
    try {
      if (!auth) {
        await initializeFirebase();
      }
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      console.log('Sign-in successful, user:', result.user);
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  }, [initializeFirebase]);

  const signOutUser = useCallback(async () => {
    try {
      if (localStorage.getItem('role') === 'node') {
        localStorage.removeItem('nodeId');
        localStorage.removeItem('role');
        setRole(null);
        setNodeId(null);
      } else {
        await signOut(auth);
      }

      const indexedDB = await initializeIndexedDB();
      const tx = indexedDB.transaction('store', 'readwrite');
      const store = tx.objectStore('store');
      await new Promise((resolve, reject) => {
        const request = store.delete('dcrypt_identity');
        request.onsuccess = () => resolve();
        request.onerror = () => reject(new Error('Failed to delete keypair from IndexedDB'));
      });

      setUser(null);
      updateUIForSignOut();
    } catch (error) {
      console.error('Sign-out failed:', error);
      throw error;
    }
  }, []);

  const handleSignup = useCallback(async (username, profileImageFile) => {
    if (isSigningUp) return;
    isSigningUp = true;

    localStorage.setItem('pendingRole', 'user');

    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const profileImageUrl = profileImageFile ? await uploadProfileImage(result.user.uid, profileImageFile) : null;

      const userRef = doc(db, 'users', result.user.uid);
      await setDoc(userRef, {
        username: username || result.user.displayName || 'Anonymous User',
        profileImageUrl: profileImageUrl || null,
        createdAt: Date.now(),
        snippetsPosted: 0,
      }, { merge: true });

      setUser(result.user);
    } finally {
      isSigningUp = false;
      localStorage.removeItem('pendingRole');
    }
  }, []);

  const uploadProfileImage = async (userId, file) => {
    if (!file) return null;
    try {
      const storageRef = ref(storage, `profile_images/${userId}/${file.name}`);
      await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(storageRef);
      return downloadURL;
    } catch (error) {
      console.error('Failed to upload profile image:', error);
      throw error;
    }
  };

  const becomeNode = useCallback(async () => {
    const nodeId = generateUUID();
    localStorage.setItem('nodeId', nodeId);
    localStorage.setItem('role', 'node');
    setNodeId(nodeId);
    setRole('node');
    const nodeRef = doc(db, 'nodes', nodeId);
    await setDoc(nodeRef, { role: 'node', createdAt: Date.now(), status: 'active' }, { merge: true });
    navigate('/node-instructions');
  }, [navigate]);

  const initNode = useCallback(async () => {
    try {
      const nodeId = localStorage.getItem('nodeId');
      const role = localStorage.getItem('role');
      localStorage.removeItem('nodeId');
      localStorage.removeItem('role');
      sessionStorage.setItem('nodeId', nodeId);
      sessionStorage.setItem('role', role);
      setNodeId(nodeId);
      setRole(role);
    } catch (error) {
      console.error('Error initializing node instructions:', error);
      throw error;
    }
  }, []);

  const updateUserProfile = useCallback(async (userId) => {
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
      throw error;
    }
  }, []);

  const updateUIForSignOut = useCallback(() => {
    const elements = {
      publishedItemsTableBody: document.getElementById('publishedItems')?.querySelector('tbody'),
      mySnippetsTableBody: document.getElementById('mySnippets')?.querySelector('tbody'),
      transactionList: document.getElementById('transactionList'),
      userBalanceElement: document.getElementById('userBalance'),
      userNameElement: document.getElementById('userName'),
      userAvatarElement: document.querySelector('.user-avatar'),
      snippetsPostedElement: document.getElementById('snippetsPosted'),
    };

    if (elements.publishedItemsTableBody) elements.publishedItemsTableBody.innerHTML = '';
    if (elements.mySnippetsTableBody) elements.mySnippetsTableBody.innerHTML = '';
    if (elements.transactionList) elements.transactionList.innerHTML = 'No transactions yet.';
    if (elements.userBalanceElement) elements.userBalanceElement.textContent = 'Balance: 0 DCT';
    if (elements.userNameElement) elements.userNameElement.textContent = 'Guest User';
    if (elements.userAvatarElement) {
      elements.userAvatarElement.innerHTML = '<i class="fas fa-user text-lg"></i>';
    }
    if (elements.snippetsPostedElement) elements.snippetsPostedElement.textContent = '0';

    localStorage.removeItem('userKeypair');
    localStorage.removeItem('peerId');
    localStorage.removeItem('dhtInitialized');
  }, []);

  const init = useCallback(async (userId) => {
    if (isInitializing) return;
    setIsInitializing(true);
    try {
      const indexedDB = await initializeIndexedDB();
      let keypair = await loadKeypair(indexedDB);
      if (keypair instanceof Uint8Array) {
        keypair = uint8ArrayToBase64Url(keypair);
      }
      if (!keypair && userId) {
        await storeKeypair(indexedDB, userId);
        keypair = userId;
      } else if (!keypair) {
        throw new Error('No keypair available and no userId provided to create one');
      } else if (keypair.length > 40) {
        keypair = userId;
        await storeKeypair(indexedDB, userId);
      }

      const isNode = await checkIfUserIsNode(userId);
      window.dht = new DHT(keypair, isNode); // Use the imported DHT class
      await window.dht.initDB();
      await window.dht.initSwarm();
      await window.dht.syncUserData();
    } catch (error) {
      console.error('Error initializing application:', error);
      throw error;
    } finally {
      setIsInitializing(false);
    }
  }, [isInitializing]);

  const checkIfUserIsNode = async (userId) => {
    try {
      const nodeRef = doc(db, 'nodes', userId);
      const nodeSnap = await getDoc(nodeRef);
      return nodeSnap.exists();
    } catch (error) {
      console.error('Failed to check node status:', error);
      return false;
    }
  };

  useEffect(() => {
    if (!auth) return;
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  return {
    user,
    role,
    nodeId,
    initializeFirebase,
    isAuthenticated,
    signIn,
    signOutUser,
    handleSignup,
    becomeNode,
    initNode,
    updateUserProfile,
    updateUIForSignOut,
    init,
  };
};

// Utility functions (moved from index.js)
const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

const initializeIndexedDB = async () => {
  const TARGET_VERSION = 5;
  return new Promise((resolve, reject) => {
    const checkRequest = indexedDB.open('dcrypt_db');

    checkRequest.onsuccess = () => {
      const db = checkRequest.result;
      const currentVersion = db.version;
      db.close();

      const openRequest = indexedDB.open('dcrypt_db', Math.max(currentVersion, TARGET_VERSION));

      openRequest.onupgradeneeded = (event) => {
        const db = openRequest.result;
        if (!db.objectStoreNames.contains('store')) {
          db.createObjectStore('store', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('transactions')) {
          db.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('offlineQueue')) {
          db.createObjectStore('offlineQueue', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('chunkCache')) {
          db.createObjectStore('chunkCache', { keyPath: 'id' });
        }
      };

      openRequest.onsuccess = () => {
        const db = openRequest.result;
        resolve(db);
      };

      openRequest.onerror = () => {
        reject(new Error(`Failed to open IndexedDB: ${openRequest.error.message}`));
      };
    };

    checkRequest.onerror = () => {
      reject(new Error(`Failed to check IndexedDB version: ${checkRequest.error.message}`));
    };
  });
};

const loadKeypair = (indexedDB) => {
  return new Promise((resolve, reject) => {
    try {
      const tx = indexedDB.transaction('store', 'readonly');
      const store = tx.objectStore('store');
      const request = store.get('dcrypt_identity');

      request.onsuccess = () => {
        const value = request.result?.value;
        if (value && typeof value === 'string') {
          resolve(value);
        } else {
          resolve(null);
        }
      };

      request.onerror = () => {
        reject(new Error('Failed to load keypair from IndexedDB'));
      };
    } catch (error) {
      reject(error);
    }
  });
};

const storeKeypair = (indexedDB, userId) => {
  return new Promise((resolve, reject) => {
    try {
      const tx = indexedDB.transaction('store', 'readwrite');
      const store = tx.objectStore('store');
      const request = store.put({ id: 'dcrypt_identity', value: userId });

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(new Error('Failed to store keypair in IndexedDB'));
      };
    } catch (error) {
      reject(error);
    }
  });
};