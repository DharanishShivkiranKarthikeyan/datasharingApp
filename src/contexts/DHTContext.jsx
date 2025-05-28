import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { DHT } from '../lib/dht';
import { useAuth } from './AuthContext';

const DHTContext = createContext(null);

export const DHTProvider = ({ children }) => {
  const [dht, setDHT] = useState(null);
  const { user } = useAuth();
  const initializingRef = useRef(false);

  useEffect(() => {
    if (!user || initializingRef.current) return;
    
    const initDHT = async () => {
      try {
        initializingRef.current = true;
        const dhtInstance = new DHT(user.uid, false);
        await dhtInstance.initDB();
        await dhtInstance.initSwarm();
        await dhtInstance.syncUserData();
        setDHT(dhtInstance);
      } catch (error) {
        console.error('DHT initialization failed:', error);
      } finally {
        initializingRef.current = false;
      }
    };

    initDHT();

    return () => {
      if (dht) {
        dht.destroy();
        setDHT(null);
      }
    };
  }, [user]);

  return (
    <DHTContext.Provider value={{ dht }}>
      {children}
    </DHTContext.Provider>
  );
};

export const useDHT = () => {
  const context = useContext(DHTContext);
  if (!context) {
    throw new Error('useDHT must be used within a DHTProvider');
  }
  return context;
};