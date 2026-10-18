import '@testing-library/react';

// Mock localStorage if missing in jsdom
if (typeof window !== 'undefined' && !window.localStorage) {
  const store: Record<string, string> = {};
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, value: string) => {
        store[key] = value.toString();
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        for (const k in store) delete store[k];
      },
    },
    writable: true,
  });
}
