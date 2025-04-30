import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Dashboard from './components/Dashboard.jsx';
import Signup from './components/Signup.jsx';
import NodeInstructions from './components/NodeInstructions.jsx';
import { useAuth } from './hooks/useAuth.js';
import { ToastProvider } from './components/ToastContext.jsx';
import VantaBackground from './components/VantaBackground.jsx';

const App = () => {
  const { initializeFirebase, user, role, nodeId, init } = useAuth();

  useEffect(() => {
    const setupApp = async () => {
      await initializeFirebase();
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
  }, [user, initializeFirebase, init]);

  return (
    <ToastProvider>
      <Router basename="/datasharingApp">
        <VantaBackground />
        <Routes>
          <Route
            path="/"
            element={<Dashboard />}
          />
          <Route
            path="/signup"
            element={<Signup />}
          />
          <Route
            path="/node-instructions"
            element={
              role === 'node' && nodeId ? (
                <NodeInstructions />
              ) : (
                <Navigate to="/signup" />
              )
            }
          />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Router>
    </ToastProvider>
  );
};

export default App;