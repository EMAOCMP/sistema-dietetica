import { useEffect, useState } from 'react';
import { WifiOff, Wifi, RefreshCw } from 'lucide-react';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { getPendingQueueCount } from '../../lib/syncEngine';

export function OfflineIndicator() {
  const { isOnline, wasOffline } = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const updateCount = async () => {
      const count = await getPendingQueueCount();
      setPendingCount(count);
    };
    
    updateCount();
    const interval = setInterval(updateCount, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (isOnline && wasOffline && pendingCount > 0) {
      setSyncing(true);
      // El syncEngine ya procesa automáticamente al volver online
      // Solo esperamos un poco y actualizamos
      const checkSync = setInterval(async () => {
        const count = await getPendingQueueCount();
        setPendingCount(count);
        if (count === 0) {
          setSyncing(false);
          clearInterval(checkSync);
        }
      }, 1000);
      return () => clearInterval(checkSync);
    }
  }, [isOnline, wasOffline]);

  if (isOnline && pendingCount === 0 && !wasOffline) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 animate-in slide-in-from-right duration-300">
      <div className={`flex items-center gap-2 px-3 py-2 rounded-xl shadow-xl border text-sm font-medium transition-all ${
        !isOnline 
          ? 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-200'
          : pendingCount > 0
            ? 'bg-sky-50 border-sky-200 text-sky-800 dark:bg-sky-900/30 dark:border-sky-700 dark:text-sky-200'
            : 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-900/30 dark:border-emerald-700 dark:text-emerald-200'
      }`}>
        {!isOnline && (
          <>
            <WifiOff className="w-5 h-5 text-amber-600 dark:text-amber-400 animate-pulse" />
            <span className="font-semibold">Sin conexión</span>
            <span className="px-2 py-0.5 text-xs bg-amber-100 dark:bg-amber-900/50 rounded-full">
              Offline
            </span>
          </>
        )}
        {isOnline && pendingCount > 0 && (
          <>
            {syncing ? (
              <RefreshCw className="w-5 h-5 text-sky-600 dark:text-sky-400 animate-spin" />
            ) : (
              <RefreshCw className="w-5 h-5 text-sky-600 dark:text-sky-400" />
            )}
            <span className="font-medium">Sincronizando...</span>
            <span className="px-2 py-0.5 text-xs bg-sky-100 dark:bg-sky-900/50 rounded-full">
              {pendingCount} pendiente{pendingCount !== 1 ? 's' : ''}
            </span>
          </>
        )}
        {isOnline && pendingCount === 0 && wasOffline && (
          <>
            <Wifi className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <span className="font-medium">Conectado</span>
            <span className="px-2 py-0.5 text-xs bg-emerald-100 dark:bg-emerald-900/50 rounded-full">
              Todo sincronizado
            </span>
          </>
        )}
      </div>
    </div>
  );
}