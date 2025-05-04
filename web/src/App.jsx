import React, { useState } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { auth, db } from './utils/firebase';
import { signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import Navbar from './components/Navbar';
import Home from './components/Home';
import NodeInstructions from './components/NodeInstructions';
import Publish from './components/Publish';
import Signup from './components/Signup';
import { DHT } from './utils/dht';
import { initializeIndexedDB, loadKeypair, storeKeypair } from './utils/helpers';

function App() {
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [dht, setDht] = useState(null);
  const [appInitialized, setAppInitialized] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // Initialize Firebase and DHT once at app start
  const initializeAppOnce = async (keypair) => {
    if (appInitialized) return;
    try {
      const indexedDB = await initializeIndexedDB();
      let storedKeypair = await loadKeypair(indexedDB);
      if (!storedKeypair && keypair) {
        await storeKeypair(indexedDB, keypair);
        storedKeypair = keypair;
      }
      if (!storedKeypair) throw new Error('No keypair available');
      const dhtInstance = new DHT(storedKeypair, localStorage.getItem('role') === 'node');
      await dhtInstance.initDB();
      await dhtInstance.initSwarm();
      await dhtInstance.syncUserData();
      setDht(dhtInstance);
      window.dht = dhtInstance;
      setAppInitialized(true);
    } catch (error) {
      console.error('Initialization failed:', error);
      showToast(`Initialization failed: ${error.message}`, true);
    }
  };

  // Cleanup on logout or app close
  const destroyApp = () => {
    if (dht) {
      dht.destroy();
      setDht(null);
      window.dht = null;
    }
    setAppInitialized(false);
    setUserProfile(null);
  };

  // Handle auth state changes
  React.useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        const userRef = doc(db, 'users', currentUser.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) setUserProfile(userSnap.data());
        await initializeAppOnce(currentUser.uid);
      } else if (localStorage.getItem('role') === 'node' && localStorage.getItem('nodeId')) {
        await initializeAppOnce(localStorage.getItem('nodeId'));
      } else {
        destroyApp();
      }
    });
    return () => unsubscribe();
  }, []);

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
      destroyApp();
      const indexedDB = await initializeIndexedDB();
      const tx = indexedDB.transaction('store', 'readwrite');
      const store = tx.objectStore('store');
      await new Promise((resolve, reject) => {
        const request = store.delete('dcrypt_identity');
        request.onsuccess = resolve;
        request.onerror = () => reject(new Error('Failed to delete keypair'));
      });
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
      setTimeout(() => toast.style.display = 'none', 3000);
    }
  };

  return (
    <div className="min-h-screen">
      <Navbar user={user} userProfile={userProfile} signIn={signIn} signOut={signOutUser} />
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