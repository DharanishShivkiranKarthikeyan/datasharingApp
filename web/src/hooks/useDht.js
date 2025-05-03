import { useState, useEffect } from 'react';
import { DHT } from '../utils/dht';

export default function useDht() {
  const [dht, setDht] = useState(null);

  const initDht = async (keypair, isNode) => {
    try {
      const instance = new DHT(keypair, isNode);
      await instance.initDB();
      await instance.initSwarm();
      await instance.syncUserData();
      setDht(instance);
      window.dht = instance;
    } catch (error) {
      console.error('DHT initialization failed:', error);
      throw error;
    }
  };

  const destroyDht = () => {
    if (dht) {
      dht.destroy();
      setDht(null);
      window.dht = null;
    }
  };

  useEffect(() => {
    return () => destroyDht();
  }, []);

  return { dht, initDht, destroyDht };
}