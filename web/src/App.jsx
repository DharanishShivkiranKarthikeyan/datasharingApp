// App.jsx
import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Dashboard from './components/Dashboard.jsx';
import Signup from './components/Signup.jsx';
import NodeInstructions from './components/NodeInstructions.jsx';
import { useAuth } from './hooks/useAuth.js';
import { ToastProvider } from './components/ToastContext.jsx';

const App = () => {
  const { user, role, nodeId, signIn, signOutUser, updateUserProfile, updateUIForSignOut } = useAuth();

  return (
    <ToastProvider>
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
            />
          }
        />
        <Route path="/signup" element={<Signup />} />
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
    </ToastProvider>
  );
};

export default App;