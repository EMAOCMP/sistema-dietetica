import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOnlineStatus } from '../useOnlineStatus';

describe('useOnlineStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'onLine', { writable: true, value: true });
  });

  it('returns online status', () => {
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true });
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current.isOnline).toBe(true);
    expect(result.current.wasOffline).toBe(false);
  });

  it('detects offline', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, writable: true });
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current.isOnline).toBe(false);
    expect(result.current.wasOffline).toBe(true);
  });

  it('updates on online event', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, writable: true });
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current.isOnline).toBe(false);

    act(() => {
      Object.defineProperty(navigator, 'onLine', { value: true, writable: true });
      window.dispatchEvent(new Event('online'));
    });

    expect(result.current.isOnline).toBe(true);
  });

  it('updates on offline event', () => {
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true });
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current.isOnline).toBe(true);

    act(() => {
      Object.defineProperty(navigator, 'onLine', { value: false, writable: true });
      window.dispatchEvent(new Event('offline'));
    });

    expect(result.current.isOnline).toBe(false);
    expect(result.current.wasOffline).toBe(true);
  });
});