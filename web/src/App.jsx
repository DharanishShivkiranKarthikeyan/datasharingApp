import React, { useState, useEffect } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { auth } from './utils/firebase';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import Navbar from './components/Navbar';
import Home from './components/Home';
import NodeInstructions from './components/NodeInstructions';
import Publish from './components/Publish';
import Signup from './components/Signup';
import useDht from './hooks/useDHT';
import { initializeIndexedDB, loadKeypair, storeKeypair } from './utils/helpers';

function App() {
  const [user, setUser] = useState(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const navigate = useNavigate();
  const { dht, initDht, destroyDht } = useDht();

  useEffect(() => {
    let unsubscribe = null;
    const initialize = async () => {
      unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
        setUser(currentUser);
        if (currentUser && !isInitialized) {
          await initializeApp(currentUser.uid);
          setIsInitialized(true);
        } else if (!currentUser && localStorage.getItem('role') === 'node' && localStorage.getItem('nodeId') && !isInitialized) {
          await initializeApp(localStorage.getItem('nodeId'));
          setIsInitialized(true);
        } else if (!currentUser && isInitialized) {
          destroyDht();
          setIsInitialized(false);
        }
      });
    };
    initialize();
    return () => {
      if (unsubscribe) unsubscribe();
      if (isInitialized) destroyDht();
    };
  }, [isInitialized]);

  const initializeApp = async (keypair) => {
    try {
      const indexedDB = await initializeIndexedDB();
      let storedKeypair = await loadKeypair(indexedDB);
      if (!storedKeypair && keypair) {
        await storeKeypair(indexedDB, keypair);
        storedKeypair = keypair;
      }
      if (!storedKeypair) throw new Error('No keypair available');
      await initDht(storedKeypair, localStorage.getItem('role') === 'node');
    } catch (error) {
      console.error('Initialization failed:', error);
      showToast(`Initialization failed: ${error.message}`, true);
    }
  };

  const signIn = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Login failed:', error);
      showToast(`Login failed: ${error.message}`, true);
    }
  };

  const signOutUser = async () => {
    try {
      if (localStorage.getItem('role') === 'node') {
        localStorage.removeItem('nodeId');
        localStorage.removeItem('role');
        showToast('Node signed out successfully!');
      } else {
        await signOut(auth);
        showToast('Signed out successfully!');
      }
      destroyDht();
      const indexedDB = await initializeIndexedDB();
      const tx = indexedDB.transaction('store', 'readwrite');
      const store = tx.objectStore('store');
      await new Promise((resolve, reject) => {
        const request = store.delete('dcrypt_identity');
        request.onsuccess = resolve;
        request.onerror = () => reject(new Error('Failed to delete keypair'));
      });
      setIsInitialized(false);
      navigate('/');
    } catch (error) {
      console.error('Sign-out failed:', error);
      showToast(`Sign-out failed: ${error.message}`, true);
    }
  };

  const showToast = (message, isError = false) => {
    const toast = document.getElementById('toast');
    if (toast) {
      toast.textContent = message;
      toast.className = `toast ${isError ? 'error-toast' : ''}`;
      toast.style.display = 'block';
      setTimeout(() => {
        toast.style.display = 'none';
      }, 3000); 
    }
  };

  return (
    <div className="min-h-screen">
      <Navbar user={user} signIn={signIn} signOut={signOutUser} />
      <Routes>
        <Route path="/" element={<Home dht={dht} user={user} showToast={showToast} />} />
        <Route path="/node-instructions" element={<NodeInstructions dht={dht} showToast={showToast} />} />
        <Route path="/publish" element={<Publish dht={dht} user={user} showToast={showToast} />} />
        <Route path="/signup" element={<Signup setUser={setUser} showToast={showToast} />} />
      </Routes>
      <div id="toast" className="toast"></div>
    </div>
  );
}

export default App;