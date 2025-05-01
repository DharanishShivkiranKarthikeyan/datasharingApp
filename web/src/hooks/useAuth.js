// useAuth.js
import { useState, useEffect, useCallback, useRef } from 'react';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useNavigate } from 'react-router-dom';
import { DHT, uint8ArrayToBase64Url } from '../lib/dht';
import { initializeIndexedDB, loadKeypair } from '../lib/utils';
import { auth, db, storage } from '../firebase';

// Global flag to prevent multiple initializations across all hook instances
let isAppInitialized = false;

let isSigningUp = false;

export const useAuth = () => {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(localStorage.getItem('role'));
  const [nodeId, setNodeId] = useState(localStorage.getItem('nodeId'));
  const navigate = useNavigate();
  const isInitializedRef = useRef(false);
  const authStateHandledRef = useRef(false);

  // Debug: Log when hook is instantiated
  console.log('useAuth hook instantiated');

  const initializeFirebase = useCallback(async () => {
    try {
      await setPersistence(auth, browserLocalPersistence);
      console.log('Firebase services initialized with local persistence');
    } catch (error) {
      console.error('Failed to initialize Firebase services:', error);
      throw error;
    }
  }, []);

  const isAuthenticated = useCallback(() => {
    return !!auth.currentUser || localStorage.getItem('role') === 'node';
  }, []);

  const signIn = useCallback(async () => {
    try {
      await initializeFirebase();
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      console.log('Sign-in successful, user:', result.user);
      setUser(result.user);
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
      isInitializedRef.current = false;
      isAppInitialized = false;
      authStateHandledRef.current = false;
      if (window.dht) {
        window.dht.destroy();
        window.dht = null;
      }
      console.log('Signed out successfully, reset initialization flags');
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

        if (userNameElement) userNameElement.textContent = userData.username || 'Anonymous User';
        if (userAvatarElement) {
          userAvatarElement.innerHTML = userData.profileImageUrl
            ? `<img src="${userData.profileImageUrl}" alt="Profile Image" class="w-12 h-12 rounded-full object-cover">`
            : '<i class="fas fa-user text-lg"></i>';
        }
        if (snippetsPostedElement) snippetsPostedElement.textContent = userData.snippetsPosted || 0;
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
    if (elements.userAvatarElement) elements.userAvatarElement.innerHTML = '<i class="fas fa-user text-lg"></i>';
    if (elements.snippetsPostedElement) elements.snippetsPostedElement.textContent = '0';

    localStorage.removeItem('userKeypair');
    localStorage.removeItem('peerId');
    localStorage.removeItem('dhtInitialized');
  }, []);

  const init = useCallback(async (userId) => {
    if (isAppInitialized || isInitializedRef.current) {
      console.log('Application already initialized, skipping for userId:', userId);
      return;
    }
    console.log('Initializing application for userId:', userId);
    console.log('isAppInitialized:', isAppInitialized, 'isInitializedRef.current:', isInitializedRef.current);

    try {
      isAppInitialized = true;
      isInitializedRef.current = true;
      console.log('Set initialization flags: isAppInitialized:', isAppInitialized, 'isInitializedRef.current:', isInitializedRef.current);

      const indexedDB = await initializeIndexedDB();
      let keypair = await loadKeypair(indexedDB);
      if (keypair instanceof Uint8Array) keypair = uint8ArrayToBase64Url(keypair);
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
      if (window.dht) window.dht.destroy();
      window.dht = new DHT(keypair, isNode);
      await window.dht.initDB();
      await window.dht.initSwarm();
      await window.dht.syncUserData();
      console.log('Application initialized successfully for userId:', userId);
    } catch (error) {
      console.error('Error initializing application for userId:', userId, error);
      isAppInitialized = false;
      isInitializedRef.current = false;
      throw error;
    }
  }, []);

  const checkIfUserIsNode = async (userId) => {
    try {
      console.log('Checking node status for userId:', userId, 'with db:', db);
      const nodeRef = doc(db, 'nodes', userId);
      const nodeSnap = await getDoc(nodeRef);
      return nodeSnap.exists();
    } catch (error) {
      console.error('Error in checkIfUserIsNode:', error);
      return false;
    }
  };

  useEffect(() => {
    if (!auth) {
      console.warn('Auth is not initialized');
      return;
    }

    console.log('Setting up onAuthStateChanged listener');
    let timeoutId;
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (authStateHandledRef.current) {
        console.log('Auth state already handled, skipping for user:', currentUser?.uid);
        return;
      }
      authStateHandledRef.current = true;

      console.log('onAuthStateChanged triggered with user:', currentUser?.uid);
      clearTimeout(timeoutId);
      timeoutId = setTimeout(async () => {
        try {
          setUser(currentUser);
          if (currentUser && !isInitializedRef.current) {
            console.log('Calling init for authenticated user:', currentUser.uid);
            await init(currentUser.uid);
          } else if (!currentUser && !isInitializedRef.current) {
            const indexedDB = await initializeIndexedDB();
            const keypair = await loadKeypair(indexedDB);
            if (keypair) {
              console.log('Calling init for keypair:', keypair);
              await init(keypair);
            } else {
              console.log('No user or keypair available for initialization');
              updateUIForSignOut();
            }
          } else {
            console.log('Initialization skipped: isInitializedRef.current:', isInitializedRef.current);
          }
        } catch (error) {
          console.error('Error handling auth state change:', error);
          authStateHandledRef.current = false;
        }
      }, 100); // 100ms debounce
    });

    return () => {
      console.log('Cleaning up onAuthStateChanged listener');
      clearTimeout(timeoutId);
      unsubscribe();
    };
  }, [init, updateUIForSignOut]);

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

const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

const storeKeypair = (indexedDB, userId) => {
  return new Promise((resolve, reject) => {
    try {
      const tx = indexedDB.transaction('store', 'readwrite');
      const store = tx.objectStore('store');
      const request = store.put({ id: 'dcrypt_identity', value: userId });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to store keypair in IndexedDB'));
    } catch (error) {
      reject(error);
    }
  });
};