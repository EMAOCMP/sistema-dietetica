import '@testing-library/jest-dom';
import { vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock navigator.onLine
let mockOnLine = true;
Object.defineProperty(navigator, 'onLine', {
  get: () => mockOnLine,
  set: (v) => { mockOnLine = v; },
  configurable: true,
});

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Cleanup after each test
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorageMock.getItem.mockReset();
  localStorageMock.setItem.mockReset();
  localStorageMock.removeItem.mockReset();
  localStorageMock.clear.mockReset();
});

// Suppress console.error for expected warnings in tests
const originalError = console.error;
beforeAll(() => {
  console.error = (...args) => {
    if (
      args[0]?.includes?.('Warning: ReactDOM.render is no longer supported') ||
      args[0]?.includes?.('act(...)')
    ) {
      return;
    }
    originalError.call(console, ...args);
  };
});
afterAll(() => {
  console.error = originalError;
});