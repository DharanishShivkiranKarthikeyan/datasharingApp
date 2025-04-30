import React, { useEffect } from 'react';
import { useAuth } from '../hooks/useAuth.js';
import { useDHT } from '../hooks/useDHT.js';
import { useToast } from './ToastContext.jsx';

const NodeInstructions = () => {
  const { initNode } = useAuth();
  const { dht } = useDHT();
  const { showToast } = useToast();

  useEffect(() => {
    const setupNode = async () => {
      try {
        await initNode();
        const transactions = await dht.dbGetAll('transactions');
        const commissionEarnings = transactions
          .filter(tx => tx.type === 'commission')
          .reduce((total, tx) => total + (tx.amount || 0), 0);
        document.getElementById('nodeEarnings').textContent = `Total Earnings: ${commissionEarnings.toFixed(2)} DCT`;
      } catch (error) {
        showToast(`Initialization failed: ${error.message}`);
      }
    };
    setupNode();
  }, [initNode, dht, showToast]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="card max-w-md w-full">
        <h2 className="text-2xl font-bold text-center">Node Instructions</h2>
        <p className="mt-2 text-center text-sm text-gray-400">
          You are now a node in the Dcrypt network.
        </p>
        <div className="mt-4">
          <p id="nodeEarnings" className="text-lg font-medium">Total Earnings: 0 DCT</p>
        </div>
      </div>
    </div>
  );
};

export default NodeInstructions;