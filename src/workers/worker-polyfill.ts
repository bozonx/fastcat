// Mock document for PixiJS DOMPipe in Web Worker
if (typeof document === 'undefined') {
  (globalThis as any).document = {
    createElement: (tag: string) => {
      if (tag && tag.toLowerCase() === 'canvas' && typeof OffscreenCanvas !== 'undefined') {
        try {
          // Return a real OffscreenCanvas so mediabunny instanceof checks pass.
          // OffscreenCanvas natively supports .width, .height, .getContext().
          // PixiJS-required DOM properties are added via Object.assign.
          const canvas = new OffscreenCanvas(1, 1);
          return Object.assign(canvas, {
            style: {},
            appendChild: () => {},
            removeChild: () => {},
            remove: () => {},
            contains: () => false,
            addEventListener: () => {},
            removeEventListener: () => {},
          });
        } catch (e) {
          // ignore, fall through to plain mock
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
