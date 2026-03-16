// Mock document for PixiJS DOMPipe in Web Worker
if (typeof document === 'undefined') {
  (globalThis as any).document = {
    createElement: (tag: string) => {
      let offscreenCanvas: OffscreenCanvas | null = null;
      if (tag && tag.toLowerCase() === 'canvas' && typeof OffscreenCanvas !== 'undefined') {
        try {
          offscreenCanvas = new OffscreenCanvas(1, 1);
        } catch (e) {
          // ignore
        }
      }
      return {
        style: {},
        appendChild: () => {},
        removeChild: () => {},
        remove: () => {},
        contains: () => false,
        addEventListener: () => {},
        removeEventListener: () => {},
        getContext: (contextType: string, contextAttributes?: any) => {
          if (offscreenCanvas) {
            try {
              return offscreenCanvas.getContext(contextType as any, contextAttributes);
            } catch (e) {
              return null;
            }
          }
          return null;
        },
      };
    },
    body: {
      appendChild: () => {},
      removeChild: () => {},
    },
  };
  (globalThis as any).window = globalThis;
}
