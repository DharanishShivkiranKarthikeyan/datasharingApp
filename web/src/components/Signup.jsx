import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth.js';
import { useToast } from './ToastContext.jsx';
import { useNavigate } from 'react-router-dom';

const Signup = () => {
  const { handleSignup, becomeNode } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [isUserSignupOpen, setIsUserSignupOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [profileImage, setProfileImage] = useState(null);

  const openUserSignupModal = () => {
    setIsUserSignupOpen(true);
  };

  const closeUserSignupModal = () => {
    setIsUserSignupOpen(false);
    setUsername('');
    setProfileImage(null);
  };

  const onSignupSubmit = async (e) => {
    e.preventDefault();
    try {
      await handleSignup(username, profileImage);
      showToast('Sign-up successful! Redirecting to dashboard...');
      navigate('/');
    } catch (error) {
      showToast(`Sign-up failed: ${error.message}`, true);
    }
  };

  return (
    <>
      <div id="signupOptionsModal" className={`modal-overlay ${!isUserSignupOpen ? 'active' : ''}`}>
        <div className="modal-card space-y-6">
          <span className="close-btn" onClick={() => navigate('/')}>×</span>
          <div>
            <h2 className="text-2xl font-bold text-center">Join Dcrypt</h2>
            <p className="mt-2 text-center text-sm text-gray-400">
              Choose your role to get started with decentralized data sharing.
            </p>
          </div>
          <div className="flex justify-center space-x-4">
            <button className="btn btn-primary" onClick={openUserSignupModal}>Become a User</button>
            <button className="btn btn-secondary" onClick={becomeNode}>Become a Node</button>
          </div>
          <div className="text-center">
            <button onClick={() => navigate('/')} className="text-blue-400 hover:underline text-sm">Back to Dashboard</button>
          </div>
        </div>
      </div>

      <div id="userSignupModal" className={`modal-overlay ${isUserSignupOpen ? 'active' : ''}`}>
        <div className="modal-card space-y-6">
          <span className="close-btn" onClick={closeUserSignupModal}>×</span>
          <div>
            <h2 className="text-2xl font-bold text-center">Sign Up as a User</h2>
            <p className="mt-2 text-center text-sm text-gray-400">
              Complete your profile to join the Dcrypt community.
            </p>
          </div>
          <form id="userSignupForm" className="space-y-6" onSubmit={onSignupSubmit}>
            <div>
              <label htmlFor="usernameInput" className="block text-sm font-medium text-gray-300">Username</label>
              <input
                id="usernameInput"
                name="username"
                type="text"
                required
                className="input-field mt-1 block w-full px-4 py-3 placeholder-gray-500"
                placeholder="Enter your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="profileImageInput" className="block text-sm font-medium text-gray-300">Profile Image (Optional)</label>
              <div className="mt-1 flex items-center">
                <label className="input-field px-4 py-3 cursor-pointer flex items-center">
                  <span id="profileImageLabel" className="text-gray-500">
                    {profileImage ? profileImage.name : 'No file chosen'}
                  </span>
                  <input
                    id="profileImageInput"
                    name="profile-image"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => setProfileImage(e.target.files[0])}
                  />
                  <span className="ml-3 text-gray-400"><i className="fas fa-upload"></i></span>
                </label>
              </div>
            </div>
            <div>
              <button
                type="submit"
                className="btn btn-primary w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium focus:outline-none"
              >
                Sign Up with Google
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
};

export default Signup;