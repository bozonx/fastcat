// Mock document for PixiJS DOMPipe in Web Worker
if (typeof document === 'undefined') {
  (globalThis as any).document = {
    createElement: (tag: string) => {
      if (tag && tag.toLowerCase() === 'canvas' && typeof OffscreenCanvas !== 'undefined') {
        return new OffscreenCanvas(1, 1);
      }
      return {
        style: {},
        appendChild: () => {},
        removeChild: () => {},
        remove: () => {},
        contains: () => false,
        addEventListener: () => {},
        removeEventListener: () => {},
        getContext: () => null,
      };
    },
    body: {
      appendChild: () => {},
      removeChild: () => {},
    },
  };
  (globalThis as any).window = globalThis;
}
