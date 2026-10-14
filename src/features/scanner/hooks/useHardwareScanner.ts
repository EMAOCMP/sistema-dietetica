import { useEffect, useRef } from 'react';
import { HardwareScannerEngine } from '../engines/HardwareScannerEngine';

/**
 * Captura lectores USB/Bluetooth que emulan teclado (código + ENTER).
 * Delega en HardwareScannerEngine; API del hook sin cambios.
 */
export function useHardwareScanner(onScan: (code: string) => void, enabled = false) {
  const engineRef = useRef<HardwareScannerEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new HardwareScannerEngine({ onDetected: () => {} });
  }
  engineRef.current.setCallbacks({ onDetected: onScan });

  useEffect(() => {
    const engine = engineRef.current!;
    if (!enabled) {
      engine.stop();
      return;
    }
    engine.start();
    return () => engine.stop();
  }, [enabled]);
}