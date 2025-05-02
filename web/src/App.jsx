import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Dashboard from './components/Dashboard.jsx';
import Signup from './components/Signup.jsx';
import NodeInstructions from './components/NodeInstructions.jsx';
import { useAuth } from './hooks/useAuth.js';
import { useDHT } from './hooks/useDHT.js';
import { ToastProvider, useToast } from './components/ToastContext.jsx';

const AppContent = ({ user, role, nodeId, signIn, signOutUser, handleSignup, becomeNode, initNode, updateUserProfile, updateUIForSignOut, isAuthenticated, dht }) => {
  const { addToast } = useToast();

  // Map addToast to showToast with the expected signature (message, isError)
  const showToast = (message, isError) => {
    addToast(message, isError ? 'error' : 'success');
  };

  // Add loading state to prevent navigation loop
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Ensure role and nodeId are stable before rendering
    if (role && nodeId && dht !== null) {
      setIsReady(true);
    } else {
      setIsReady(false);
    }
  }, [role, nodeId, dht]);

  return (
    <Routes>
      <Route
        path="/"
        element={
          <Dashboard
            user={user}
            signIn={signIn}
            signOutUser={signOutUser}
            updateUserProfile={updateUserProfile}
            updateUIForSignOut={updateUIForSignOut}
            isAuthenticated={isAuthenticated}
            showToast={showToast}
          />
        }
      />
      <Route
        path="/signup"
        element={<Signup handleSignup={handleSignup} becomeNode={becomeNode} showToast={showToast} />}
      />
      <Route
        path="/node-instructions"
        element={
          role === 'node' && nodeId && isReady ? (
            <NodeInstructions initNode={initNode} dht={dht} showToast={showToast} />
          ) : (
            <Navigate to="/signup" replace />
          )
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

const App = () => {
  const { user, role, nodeId, signIn, signOutUser, handleSignup, becomeNode, initNode, updateUserProfile, updateUIForSignOut, isAuthenticated } = useAuth();
  const { dht } = useDHT({ user });

  return (
    <ToastProvider>
      <AppContent
        user={user}
        role={role}
        nodeId={nodeId}
        signIn={signIn}
        signOutUser={signOutUser}
        handleSignup={handleSignup}
        becomeNode={becomeNode}
        initNode={initNode}
        updateUserProfile={updateUserProfile}
        updateUIForSignOut={updateUIForSignOut}
        isAuthenticated={isAuthenticated}
        dht={dht}
      />
    </ToastProvider>
  );
};

export default App;