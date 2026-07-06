import NetInfo from '@react-native-community/netinfo';
import { useState, useEffect } from 'react';

/** Checks if the device has internet connection. */
export const checkIsConnected = async (): Promise<boolean> => {
  const state = await NetInfo.fetch();
  return !!state.isConnected;
};

/** React hook to subscribe to network status changes. */
export const useNetworkStatus = () => {
  const [isConnected, setIsConnected] = useState<boolean | null>(true);

  useEffect(() => {
    // Get initial state
    NetInfo.fetch().then((state) => {
      setIsConnected(state.isConnected);
    });

    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsConnected(state.isConnected);
    });

    return () => unsubscribe();
  }, []);

  return isConnected;
};
