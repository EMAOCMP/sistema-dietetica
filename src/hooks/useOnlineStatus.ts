import { useState, useEffect } from 'react';

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(true);
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    const updateOnline = () => {
      const online = navigator.onLine;
      setIsOnline(online);
      if (!online) setWasOffline(true);
    };

    updateOnline();
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);

    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, []);

  return { isOnline, wasOffline };
}