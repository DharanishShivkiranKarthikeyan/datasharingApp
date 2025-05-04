import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

function NodeInstructions({ dht, showToast }) {
  const [earnings, setEarnings] = useState(0);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const initNode = async () => {
      try {
        const nodeId = localStorage.getItem('nodeId');
        const role = localStorage.getItem('role');
        if (!dht || !role || role !== 'node' || !nodeId) {
          showToast('Invalid node configuration. Please sign up as a node again.', true);
          navigate('/signup');
          return;
        }
        const transactions = await dht.dbGetAll('transactions');
        if (transactions && Array.isArray(transactions)) {
          const commissionEarnings = transactions
            .filter(tx => tx.type === 'commission')
            .reduce((total, tx) => total + (tx.amount || 0), 0);
          setEarnings(commissionEarnings);
        } else {
          setEarnings(0);
        }
        setLoading(false);
      } catch (error) {
        console.error('Error fetching node data:', error);
        showToast(`Failed to load node data: ${error.message}`, true);
        setLoading(false);
      }
    };
    initNode();
  }, [dht, navigate, showToast]);

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="loader">Loading...</div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Node Instructions</h1>
        <Link to="/" className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">
          Back to Dashboard
        </Link>
      </div>
      <div className="mb-4">
        <h2 className="text-xl font-semibold mb-2">Welcome, Node Operator!</h2>
        <p className="mb-2">
          As a node, your role is to store and distribute chunks of data to ensure the network remains
          decentralized and reliable. Here are your responsibilities:
        </p>
        <ul className="list-disc list-inside mb-4">
          <li>Stay online as much as possible to serve chunks to other users.</li>
          <li>Monitor your earnings from commissions (5% of each premium snippet purchase).</li>
          <li>Ensure your browser remains open and connected to the PeerJS network.</li>
          <li>Check for updates or changes in node requirements from the Dcrypt team.</li>
        </ul>
        <h2 className="text-xl font-semibold mb-2">Your Earnings</h2>
        <p>Total Earnings: {earnings.toFixed(2)} DCT</p>
      </div>
    </div>
  );
}

export default NodeInstructions;