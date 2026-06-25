// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('worker-polyfill', () => {
  let originalDocument: PropertyDescriptor | undefined;
  let originalWindow: PropertyDescriptor | undefined;
  let originalOffscreenCanvas: typeof globalThis.OffscreenCanvas | undefined;

  beforeEach(() => {
    vi.resetModules();
    originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    originalOffscreenCanvas = globalThis.OffscreenCanvas;
    delete (globalThis as any).document;
    delete (globalThis as any).window;
  });

  afterEach(() => {
    if (originalDocument) {
      Object.defineProperty(globalThis, 'document', originalDocument);
    } else {
      delete (globalThis as any).document;
    }
    if (originalWindow) {
      Object.defineProperty(globalThis, 'window', originalWindow);
    } else {
      delete (globalThis as any).window;
    }
    if (originalOffscreenCanvas) {
      (globalThis as any).OffscreenCanvas = originalOffscreenCanvas;
    } else {
      delete (globalThis as any).OffscreenCanvas;
    }
  });

  it('creates a mock document with createElement for canvas', async () => {
    class FakeOffscreenCanvas {
      width = 1;
      height = 1;
      constructor(w: number, h: number) {
        this.width = w;
        this.height = h;
      }
      getContext() {
        return null;
      }
    }
    (globalThis as any).OffscreenCanvas = FakeOffscreenCanvas;

    await import('~/workers/worker-polyfill');

    const doc = (globalThis as any).document;
    expect(doc).toBeDefined();
    expect(typeof doc.createElement).toBe('function');

    const canvas = doc.createElement('canvas');
    expect(canvas).toBeInstanceOf(FakeOffscreenCanvas);
    expect(canvas.style).toEqual({});
    expect(typeof canvas.appendChild).toBe('function');
    expect(typeof canvas.removeChild).toBe('function');
    expect(typeof canvas.remove).toBe('function');
    expect(typeof canvas.addEventListener).toBe('function');
    expect(typeof canvas.removeEventListener).toBe('function');
    expect(canvas.contains()).toBe(false);
  });

  it('falls back to plain mock when OffscreenCanvas is unavailable', async () => {
    delete (globalThis as any).OffscreenCanvas;

    await import('~/workers/worker-polyfill');

    const doc = (globalThis as any).document;
    const element = doc.createElement('canvas');
    expect(element.style).toEqual({});
    expect(typeof element.appendChild).toBe('function');
    expect(typeof element.getContext).toBe('function');
    expect(element.getContext()).toBeNull();
  });

  it('creates non-canvas elements as plain mocks', async () => {
    (globalThis as any).OffscreenCanvas = class {
      constructor() {}
    };

    await import('~/workers/worker-polyfill');

    const doc = (globalThis as any).document;
    const div = doc.createElement('div');
    expect(div.style).toEqual({});
    expect(typeof div.appendChild).toBe('function');
    expect(div.contains()).toBe(false);
  });

  it('sets window to globalThis', async () => {
    await import('~/workers/worker-polyfill');
    expect((globalThis as any).window).toBe(globalThis);
  });

  it('provides document.body with appendChild and removeChild', async () => {
    await import('~/workers/worker-polyfill');
    const doc = (globalThis as any).document;
    expect(typeof doc.body.appendChild).toBe('function');
    expect(typeof doc.body.removeChild).toBe('function');
  });

  it('does not override an existing document', async () => {
    const existingDoc = { custom: true, createElement: () => null };
    (globalThis as any).document = existingDoc;

    await import('~/workers/worker-polyfill');

    // The polyfill checks `typeof document === 'undefined'` at import time.
    // With an existing document it should not override.
    expect((globalThis as any).document).toBe(existingDoc);
  });
});
