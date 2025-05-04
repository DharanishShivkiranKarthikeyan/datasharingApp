import React from 'react';
import { Link } from 'react-router-dom';

function Navbar({ user, userProfile, signIn, signOut }) {
  const displayName = userProfile?.username || 'User';
  const profileImage = userProfile?.profileImage;

  return (
    <nav className="bg-gray-800 p-4 flex justify-between items-center">
      <Link to="/" className="text-xl font-bold text-white">Dcrypt</Link>
      <div className="flex items-center space-x-4">
        {user ? (
          <>
            <div className="flex items-center space-x-2">
              {profileImage ? (
                <img
                  src={profileImage}
                  alt="Profile"
                  className="w-8 h-8 rounded-full object-cover"
                />
              ) : (
                <i className="fas fa-user text-gray-300 text-lg"></i>
              )}
              <span className="text-gray-300">Welcome, {displayName}</span>
            </div>
            <button
              onClick={signOut}
              className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
            >
              Logout
            </button>
          </>
        ) : (
          <>
            <button
              onClick={signIn}
              className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
            >
              Login
            </button>
            <Link
              to="/signup"
              className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600"
            >
              Sign Up
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}

export default Navbar;