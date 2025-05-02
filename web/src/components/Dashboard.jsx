// components/Dashboard.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDHT } from '../hooks/useDHT.js';
import { useToast } from './ToastContext.jsx';
import PublishModal from './PublishModal.jsx';

const Dashboard = ({ user, signIn, signOutUser, updateUserProfile, updateUIForSignOut }) => {
  const { dht, updateBalanceDisplay, updateTransactionHistory, updateLiveFeed, updateMySnippets, searchSnippets, deposit, withdraw, buySnippet, buySnippetByHash, flagSnippet, copyHash } = useDHT();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [buyHash, setBuyHash] = useState('');
  const [isTransactionHistoryVisible, setIsTransactionHistoryVisible] = useState(false);
  const [isLightMode, setIsLightMode] = useState(false);

  useEffect(() => {
    console.log('Dashboard component mounted');
    if (user) {
      updateUserProfile(user.uid);
      updateBalanceDisplay();
      updateTransactionHistory();
      updateLiveFeed();
      updateMySnippets();
    } else {
      updateUIForSignOut();
    }
    return () => console.log('Dashboard component unmounted');
  }, [user, updateUserProfile, updateBalanceDisplay, updateTransactionHistory, updateLiveFeed, updateMySnippets, updateUIForSignOut]);

  const handleSearch = () => {
    searchSnippets(searchTerm);
  };

  const toggleTransactionHistory = () => {
    setIsTransactionHistoryVisible(!isTransactionHistoryVisible);
  };

  const toggleTheme = () => {
    setIsLightMode(!isLightMode);
  };

  const redirectToPublish = () => {
    if (!user && !dht) {
      showToast('Please sign in and ensure the app is initialized before publishing.', true);
      return;
    }
    setIsPublishModalOpen(true);
  };

  return (
    <div className={isLightMode ? 'light-mode' : ''}>
      <div className="header">
        <h1 className="text-2xl font-semibold">Dcrypt - Decentralized Data Sharing</h1>
        <div className="space-x-2">
          {user ? (
            <button className="btn btn-danger" onClick={signOutUser}>Logout</button>
          ) : (
            <>
              <button className="btn btn-primary" onClick={() => navigate('/signup')}>Sign Up</button>
              <button className="btn btn-primary" onClick={signIn}>Login</button>
            </>
          )}
        </div>
      </div>
      <div className="layout">
        <div className="sidebar">
          <div className="sidebar-section">
            <h3>User Profile</h3>
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 bg-gray-600 rounded-full flex items-center justify-center user-avatar">
                <i className="fas fa-user text-lg"></i>
              </div>
              <div>
                <p id="userName" className="font-medium">Guest User</p>
                <p className="text-sm text-gray-400">Snippets Posted: <span id="snippetsPosted">0</span></p>
              </div>
            </div>
          </div>
          <div className="sidebar-section">
            <h3>Balance</h3>
            <p id="userBalance" className="text-lg font-medium">Balance: 0 DCT</p>
          </div>
          <div className="sidebar-section">
            <h3>Manage Balance</h3>
            <div className="space-y-4">
              <div className="flex space-x-2">
                <input
                  id="depositInput"
                  type="number"
                  placeholder="Deposit Amount (DCT)"
                  className="input-field flex-1"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                />
                <button
                  className="btn btn-success"
                  onClick={() => deposit(parseFloat(depositAmount))}
                  disabled={!user}
                >
                  Deposit
                </button>
              </div>
              <div className="flex space-x-2">
                <input
                  id="withdrawInput"
                  type="number"
                  placeholder="Withdraw Amount (DCT)"
                  className="input-field flex-1"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                />
                <button
                  className="btn btn-danger"
                  onClick={() => withdraw(parseFloat(withdrawAmount))}
                  disabled={!user}
                >
                  Withdraw
                </button>
              </div>
            </div>
          </div>
          <div className="sidebar-section">
            <h3>Transaction History</h3>
            <button
              className="btn btn-secondary mb-2"
              onClick={toggleTransactionHistory}
              disabled={!user}
            >
              Toggle History
            </button>
            <div id="transactionHistory" className="mt-2" style={{ display: isTransactionHistoryVisible ? 'block' : 'none' }}>
              <div id="transactionList">No transactions yet.</div>
            </div>
          </div>
          <div className="sidebar-section">
            <h3>Theme</h3>
            <button className="btn btn-primary" onClick={toggleTheme}>
              {isLightMode ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
            </button>
          </div>
        </div>
        <div className="main-content">
          <div className="card">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">Quick Actions</h2>
              <button className="btn btn-secondary" onClick={redirectToPublish}>Post Something!</button>
            </div>
            <div className="flex space-x-2">
              <input
                id="searchInput"
                type="text"
                placeholder="Search snippets..."
                className="input-field flex-1"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <button
                className="btn btn-primary"
                onClick={handleSearch}
                disabled={!user}
              >
                Search
              </button>
            </div>
          </div>
          <div className="card">
            <h2 className="text-xl font-semibold mb-4">Live Feed</h2>
            <div className="filter-group">
              <select id="sortBy" className="filter-select">
                <option value="likes-desc">Sort by Likes (High to Low)</option>
                <option value="likes-asc">Sort by Likes (Low to High)</option>
                <option value="dislikes-desc">Sort by Dislikes (High to Low)</option>
                <option value="dislikes-asc">Sort by Dislikes (Low to High)</option>
                <option value="date-desc">Sort by Date (Newest)</option>
                <option value="date-asc">Sort by Date (Oldest)</option>
              </select>
              <input id="filterTags" type="text" placeholder="Filter by tags..." className="input-field flex-1" />
            </div>
            <table id="publishedItems">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Description</th>
                  <th>Tags</th>
                  <th>Likes</th>
                  <th>Dislikes</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody></tbody>
            </table>
          </div>
          <div className="card">
            <h2 className="text-xl font-semibold mb-4">My Snippets</h2>
            <table id="mySnippets">
              <thead>
                <tr>
                  <th>Hash</th>
                  <th>Title</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody></tbody>
            </table>
          </div>
          <div className="card">
            <h2 className="text-xl font-semibold mb-4">Buy Snippet by Hash</h2>
            <div className="flex space-x-2">
              <input
                id="buyHashInput"
                type="text"
                placeholder="Enter snippet hash..."
                className="input-field flex-1"
                value={buyHash}
                onChange={(e) => setBuyHash(e.target.value)}
              />
              <button
                className="btn btn-primary"
                onClick={() => buySnippetByHash(buyHash)}
                disabled={!user}
              >
                Buy
              </button>
            </div>
          </div>
          <div className="card" id="snippetDisplay"></div>
        </div>
      </div>
      {isPublishModalOpen && (
        <PublishModal onClose={() => setIsPublishModalOpen(false)} />
      )}
    </div>
  );
};

export default Dashboard;