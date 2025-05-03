import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { db, auth } from '../utils/firebase';
import { collection, query, where, onSnapshot, getDocs, doc, updateDoc, increment, getDoc, setDoc } from 'firebase/firestore';
import { displaySnippetContent, updateUserProfile, copyHash } from '../utils/helpers';

function Home({ dht, user, showToast }) {
  const [snippets, setSnippets] = useState([]);
  const [mySnippets, setMySnippets] = useState([]);
  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showTransactions, setShowTransactions] = useState(false);

  useEffect(() => {
    if (dht && user) {
      updateLiveFeed();
      updateMySnippets();
      updateBalance();
      updateTransactionHistory();
      updateUserProfile(user.uid);
    }
  }, [dht, user]);

  const updateLiveFeed = () => {
    const q = query(collection(db, 'snippets'), where('reviewStatus', '==', 'active'));
    onSnapshot(q, (snapshot) => {
      const data = {};
      snapshot.forEach((doc) => {
        data[doc.id] = doc.data();
      });
      if (dht) {
        dht.knownObjects.clear();
        Object.entries(data).forEach(([ipHash, snippet]) => {
          const metadata = {
            content_type: snippet.ipHash,
            description: snippet.description || 'No description',
            tags: snippet.tags || [],
            isPremium: snippet.isPremium || false,
            priceUsd: snippet.priceUsd || 0,
          };
          dht.knownObjects.set(ipHash, { metadata, chunks: snippet.chunks || [] });
          dht.broadcastIP(ipHash, metadata, snippet.chunks || []);
        });
        setSnippets(Object.entries(data).filter(([_, snippet]) => snippet.reviewStatus === 'active'));
      }
    }, (error) => {
      console.error('Live feed snapshot error:', error);
      showToast('Failed to load live feed.', true);
    });
  };

  const updateMySnippets = async () => {
    const userId = auth.currentUser?.uid || localStorage.getItem('nodeId');
    if (!userId) return;
    const q = query(collection(db, 'snippets'), where('creatorId', '==', userId));
    const snapshot = await getDocs(q);
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    setMySnippets(data);
  };

  const updateBalance = async () => {
    if (dht) {
      const balance = await dht.getBalance(dht.keypair);
      setBalance(balance);
    }
  };

  const updateTransactionHistory = async () => {
    if (dht) {
      const transactions = await dht.dbGetAll('transactions');
      setTransactions(transactions);
    }
  };

  const buySnippet = async (hash) => {
    if (!dht || !user) {
      showToast('Please sign in to buy.', true);
      return;
    }
    try {
      let ipObject = dht.knownObjects.get(hash);
      if (!ipObject) {
        const snippetRef = doc(db, 'snippets', hash);
        const snapshot = await getDoc(snippetRef);
        if (!snapshot.exists()) throw new Error('Snippet not found');
        const data = snapshot.data();
        ipObject = {
          metadata: {
            content_type: data.ipHash,
            description: data.description || 'No description',
            tags: data.tags || [],
            isPremium: data.isPremium || false,
            priceUsd: data.priceUsd || 0,
          },
          chunks: data.chunks || [],
        };
        dht.knownObjects.set(hash, ipObject);
        await dht.broadcastIP(hash, ipObject.metadata, ipObject.chunks);
      }
      const isPremium = ipObject.metadata.isPremium || false;
      const priceUsd = isPremium ? ipObject.metadata.priceUsd || 0 : 0;
      const buyCost = priceUsd;
      if (buyCost > 0) {
        const balance = await dht.getBalance(dht.keypair);
        if (balance < buyCost) throw new Error('Insufficient balance');
        const commission = buyCost * 0.05;
        await dht.distributeCommission(commission);
        await dht.putBalance(dht.keypair, balance - buyCost);
        await dht.dbAdd('transactions', { type: 'buy', amount: buyCost, timestamp: Date.now() });
      } else {
        await dht.dbAdd('transactions', { type: 'buy', amount: 0, timestamp: Date.now() });
      }
      const { data, fileType } = await dht.requestData(hash);
      showToast('Snippet retrieved successfully!');
      await Promise.all([updateTransactionHistory(), updateBalance(), updateMySnippets()]);
      const feedback = prompt('Do you like this snippet? Type "like" or "dislike":');
      if (feedback) {
        const action = feedback.trim().toLowerCase();
        if (action === 'like' || action === 'dislike') {
          await submitFeedback(hash, action);
          showToast(`You ${action}d this snippet!`);
          updateLiveFeed();
        } else {
          showToast('Invalid input. Please type "like" or "dislike".', true);
        }
      }
      displaySnippetContent(data, fileType, ipObject.metadata.content_type);
    } catch (error) {
      console.error('buySnippet failed:', error);
      showToast(`Purchase failed: ${error.message}`, true);
    }
  };

  const submitFeedback = async (ipHash, action) => {
    const userId = auth.currentUser?.uid || localStorage.getItem('nodeId');
    if (!userId) return;
    try {
      const feedbackRef = doc(db, 'snippets', ipHash, 'feedback', userId);
      await setDoc(feedbackRef, { action, timestamp: Date.now() });
      const snippetRef = doc(db, 'snippets', ipHash);
      if (action === 'like') {
        await updateDoc(snippetRef, { likes: increment(1) });
      } else if (action === 'dislike') {
        await updateDoc(snippetRef, { dislikes: increment(1) });
      }
    } catch (error) {
      console.error('Failed to submit feedback:', error);
      showToast(`Failed to submit feedback: ${error.message}`, true);
    }
  };

  const flagSnippet = async (ipHash) => {
    const userId = auth.currentUser?.uid || localStorage.getItem('nodeId');
    if (!userId) {
      showToast('Please sign in to flag content.', true);
      return;
    }
    try {
      const snippetRef = doc(db, 'snippets', ipHash);
      await updateDoc(snippetRef, { flagCount: increment(1) });
      const snapshot = await getDoc(snippetRef);
      const flagCount = snapshot.data().flagCount || 0;
      if (flagCount >= 3) {
        await updateDoc(snippetRef, { reviewStatus: 'under_review' });
        showToast('Snippet has been flagged and is under review.');
        updateLiveFeed();
      } else {
        showToast('Snippet flagged. It will be reviewed if flagged by more users.');
      }
    } catch (error) {
      console.error('Failed to flag snippet:', error);
      showToast(`Failed to flag snippet: ${error.message}`, true);
    }
  };

  const searchSnippets = async () => {
    if (!searchTerm) {
      updateLiveFeed();
      return;
    }
    const searchTags = searchTerm.split(',').map(tag => tag.trim().toLowerCase()).filter(tag => tag);
    const q = query(collection(db, 'snippets'), where('reviewStatus', '==', 'active'));
    const snapshot = await getDocs(q);
    const data = {};
    snapshot.forEach(doc => {
      data[doc.id] = doc.data();
    });
    if (dht) {
      dht.knownObjects.clear();
      Object.entries(data).forEach(([ipHash, snippet]) => {
        const metadata = {
          content_type: snippet.ipHash,
          description: snippet.description || 'No description',
          tags: snippet.tags || [],
          isPremium: snippet.isPremium || false,
          priceUsd: snippet.priceUsd || 0,
        };
        dht.knownObjects.set(ipHash, { metadata, chunks: snippet.chunks || [] });
      });
      const filtered = Object.entries(data).filter(([_, snippet]) => {
        const tags = (snippet.tags || []).map(tag => tag.toLowerCase());
        return snippet.reviewStatus === 'active' && (!searchTags.length || searchTags.some(tag => tags.includes(tag)));
      });
      setSnippets(filtered);
    }
  };

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Dashboard</h1>
      <div className="flex justify-between mb-4">
        <Link to="/publish" className="bg-purple-500 text-white px-4 py-2 rounded hover:bg-purple-600">
          Publish Snippet
        </Link>
        <div>
          <span className="mr-4">Balance: {balance.toFixed(2)} DCT</span>
          <button
            onClick={() => setShowTransactions(!showTransactions)}
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
          >
            {showTransactions ? 'Hide' : 'Show'} Transactions
          </button>
        </div>
      </div>
      <div className="mb-4">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search by tags (comma-separated)"
          className="w-full p-3 bg-gray-700 text-white rounded"
        />
        <button
          onClick={searchSnippets}
          className="mt-2 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        >
          Search
        </button>
      </div>
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-2">Published Snippets</h2>
        <table className="w-full text-left">
          <thead>
            <tr className="bg-gray-700">
              <th className="p-2">Title</th>
              <th className="p-2">Description</th>
              <th className="p-2">Tags</th>
              <th className="p-2">Likes</th>
              <th className="p-2">Dislikes</th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {snippets.map(([ipHash, snippet]) => (
              <tr key={ipHash} className="border-b border-gray-600">
                <td className="p-2">{snippet.title}</td>
                <td className="p-2">{snippet.description || 'No description'}</td>
                <td className="p-2">{snippet.tags?.join(', ') || 'No tags'}</td>
                <td className="p-2">{snippet.likes || 0}</td>
                <td className="p-2">{snippet.dislikes || 0}</td>
                <td className="p-2">
                  <button
                    onClick={() => buySnippet(ipHash)}
                    className="bg-purple-500 text-white px-3 py-1 rounded hover:bg-purple-600 mr-2"
                  >
                    Get ({snippet.priceUsd > 0 ? `${snippet.priceUsd} DCT` : 'Free'})
                  </button>
                  <button
                    onClick={() => flagSnippet(ipHash)}
                    className="bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600"
                  >
                    Flag
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-2">My Snippets</h2>
        <table className="w-full text-left">
          <thead>
            <tr className="bg-gray-700">
              <th className="p-2">Hash</th>
              <th className="p-2">Title</th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {mySnippets.map(snippet => (
              <tr key={snippet.id} className="border-b border-gray-600">
                <td className="p-2">{snippet.ipHash}</td>
                <td className="p-2">{snippet.title || 'No title'}</td>
                <td className="p-2">
                  <button
                    onClick={() => copyHash(snippet.ipHash)}
                    className="bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600"
                  >
                    Copy Hash
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showTransactions && (
        <div>
          <h2 className="text-xl font-semibold mb-2">Transaction History</h2>
          <div className="bg-gray-800 p-4 rounded">
            {transactions.length === 0 ? (
              <p>No transactions yet.</p>
            ) : (
              transactions.map((tx, index) => (
                <p key={index} className="py-1">
                  {tx.type} - {tx.amount} DCT - {new Date(tx.timestamp).toLocaleString()}
                </p>
              ))
            )}
          </div>
        </div>
      )}
      <div id="snippetDisplay" className="mt-4"></div>
    </div>
  );
}

export default Home;