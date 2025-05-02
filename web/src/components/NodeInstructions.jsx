import React, { useEffect, useState, useCallback } from 'react';

const NodeInstructions = ({ initNode, dht, showToast }) => {
  const [isLoading, setIsLoading] = useState(true);

  // Memoize setupNode to prevent redefinition on every render
  const setupNode = useCallback(async () => {
    if (!dht) {
      console.log('DHT not initialized');
      showToast('DHT not initialized. Please try again.', true);
      setIsLoading(false);
      return;
    }
    try {
      await initNode();
      const transactions = await dht.dbGetAll('transactions');
      const commissionEarnings = transactions
        .filter(tx => tx.type === 'commission')
        .reduce((total, tx) => total + (tx.amount || 0), 0);
      document.getElementById('nodeEarnings').textContent = `Total Earnings: ${commissionEarnings.toFixed(2)} DCT`;
      showToast('Node initialized successfully', false);
      console.log('Node setup complete, earnings:', commissionEarnings);
    } catch (error) {
      console.error('Node initialization failed:', error);
      showToast(`Initialization failed: ${error.message}`, true);
    } finally {
      setIsLoading(false);
    }
  }, [dht, initNode, showToast]);

  useEffect(() => {
    console.log('NodeInstructions component mounted');
    setupNode();
    return () => console.log('NodeInstructions component unmounted');
  }, [setupNode]); // Use setupNode as a stable dependency

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="card max-w-md w-full">
        <h2 className="text-2xl font-bold text-center">Node Instructions</h2>
        <p className="mt-2 text-center text-sm text-gray-400">
          You are now a node in the Dcrypt network.
        </p>
        <div className="mt-4">
          {isLoading ? (
            <p className="text-lg font-medium">Loading...</p>
          ) : (
            <p id="nodeEarnings" className="text-lg font-medium">Total Earnings: 0 DCT</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default NodeInstructions;