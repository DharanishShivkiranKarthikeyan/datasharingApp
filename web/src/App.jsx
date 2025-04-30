import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Dashboard from './components/Dashboard.jsx';
import Signup from './components/Signup.jsx';
import NodeInstructions from './components/NodeInstructions.jsx';
import { useAuth } from './hooks/useAuth.js';
import { ToastProvider } from './components/ToastContext.jsx';
import { initializeIndexedDB,loadKeypair } from './lib/utils.js';

const App = () => {
  const { user, role, nodeId, init } = useAuth();

  useEffect(() => {
    const setupApp = async () => {
      if (user) {
        await init(user.uid);
      } else {
        const indexedDB = await initializeIndexedDB();
        const keypair = await loadKeypair(indexedDB);
        if (keypair) {
          await init(keypair);
        }
      }
    };
    setupApp();
  }, [user, init]);

  return (
    <ToastProvider>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/signup" element={<Signup />} />
        <Route
          path="/datasharingApp/node-instructions"
          element={
            role === 'node' && nodeId ? (
              <NodeInstructions />
            ) : (
              <Navigate to="/datasharingApp/signup" />
            )
          }
        />
        <Route path="*" element={<Navigate to="/datasharingApp/" />} />
      </Routes>
    </ToastProvider>
  );
};

export default App;