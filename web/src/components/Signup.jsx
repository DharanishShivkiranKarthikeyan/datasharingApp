import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { auth, db } from '../utils/firebase';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { generateUUID } from '../utils/helpers';
import { initializeAppOnce } from '../App'; // Import from App.jsx

function Signup({ setUser, showToast }) {
  const [showUserModal, setShowUserModal] = useState(false);
  const [username, setUsername] = useState('');
  const [profileImage, setProfileImage] = useState(null);
  const navigate = useNavigate();

  const handleUserSignup = async (e) => {
    e.preventDefault();
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const userRef = doc(db, 'users', result.user.uid);
      await setDoc(userRef, {
        username: username || result.user.displayName || 'Anonymous User',
        profileImageUrl: null,
        createdAt: Date.now(),
        snippetsPosted: 0,
      }, { merge: true });
      setUser(result.user);
      showToast('Sign-up successful! Redirecting to dashboard...');
      navigate('/');
    } catch (error) {
      console.error('Signup failed:', error);
      showToast(`Sign-up failed: ${error.message}`, true);
    }
  };

  const becomeNode = async () => {
    const nodeId = generateUUID();
    const peerId = `node-${nodeId}`;
    localStorage.setItem('nodeId', nodeId);
    localStorage.setItem('role', 'node');
    const nodeRef = doc(db, 'nodes', nodeId);
    await setDoc(nodeRef, {
      role: 'node',
      createdAt: Date.now(),
      status: 'active',
      peerId: peerId
    }, { merge: true });
    showToast('Node registered successfully!');
    await initializeAppOnce(nodeId); // Initialize DHT before navigating
    navigate('/node-instructions');
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      {!showUserModal ? (
        <div className="bg-gray-800 p-8 rounded-lg max-w-md w-full space-y-6 border border-gray-600">
          <span
            className="absolute top-4 right-4 text-2xl cursor-pointer text-gray-300 hover:text-yellow-500"
            onClick={() => navigate('/')}
          >
            ×
          </span>
          <h2 className="text-2xl font-bold text-center">Join Dcrypt</h2>
          <p className="mt-2 text-center text-sm text-gray-400">
            Choose your role to get started with decentralized data sharing.
          </p>
          <div className="flex justify-center space-x-4">
            <button
              onClick={() => setShowUserModal(true)}
              className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
            >
              Become a User
            </button>
            <button
              onClick={becomeNode}
              className="bg-yellow-500 text-gray-900 px-4 py-2 rounded hover:bg-yellow-600"
            >
              Become a Node
            </button>
          </div>
          <div className="text-center">
            <Link to="/" className="text-blue-400 hover:underline text-sm">Back to Dashboard</Link>
          </div>
        </div>
      ) : (
        <div className="bg-gray-800 p-8 rounded-lg max-w-md w-full space-y-6 border border-gray-600">
          <span
            className="absolute top-4 right-4 text-2xl cursor-pointer text-gray-300 hover:text-yellow-500"
            onClick={() => setShowUserModal(false)}
          >
            ×
          </span>
          <h2 className="text-2xl font-bold text-center">Sign Up as a User</h2>
          <p className="mt-2 text-center text-sm text-gray-400">
            Complete your profile to join the Dcrypt community.
          </p>
          <form className="space-y-6" onSubmit={handleUserSignup}>
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-300">Username</label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="mt-1 block w-full px-4 py-3 bg-gray-700 text-white rounded-lg focus:outline-none focus:border-blue-500 focus:ring focus:ring-blue-500 placeholder-gray-500"
                placeholder="Enter your username"
              />
            </div>
            <div>
              <label htmlFor="profileImage" className="block text-sm font-medium text-gray-300">Profile Image (Optional)</label>
              <div className="mt-1 flex items-center">
                <label className="px-4 py-3 bg-gray-700 rounded-lg cursor-pointer flex items-center">
                  <span className="text-gray-500">{profileImage ? profileImage.name : 'No file chosen'}</span>
                  <input
                    id="profileImage"
                    type="file"
                    accept="image/*"
                    onChange={(e) => setProfileImage(e.target.files[0])}
                    className="hidden"
                  />
                  <span className="ml-3 text-gray-400"><i className="fas fa-upload"></i></span>
                </label>
              </div>
            </div>
            <button
              type="submit"
              className="w-full bg-blue-500 text-white py-3 px-4 rounded-lg hover:bg-blue-600 focus:outline-none"
            >
              Sign Up with Google
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export default Signup;