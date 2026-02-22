// Mock document for PixiJS DOMPipe in Web Worker
if (typeof document === 'undefined') {
  (globalThis as any).document = {
    createElement: () => ({
      style: {},
      appendChild: () => {},
      removeChild: () => {},
      remove: () => {},
      contains: () => false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
    body: {
      appendChild: () => {},
      removeChild: () => {},
    }
  };
  (globalThis as any).window = globalThis;
}
