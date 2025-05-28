import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { DHTProvider } from './contexts/DHTContext';
import { AuthProvider } from './contexts/AuthContext';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import NodeInstructions from './pages/NodeInstructions';
import SignUp from './pages/SignUp';

const App = () => {
  return (
    <AuthProvider>
      <DHTProvider>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="signup" element={<SignUp />} />
            <Route path="node-instructions" element={<NodeInstructions />} />
          </Route>
        </Routes>
      </DHTProvider>
    </AuthProvider>
  );
};

export default App;