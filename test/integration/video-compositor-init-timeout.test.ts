// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { Application } from 'pixi.js';
import { VideoCompositor } from '~/utils/video-editor/VideoCompositor';

class MockOffscreenCanvas {
  width: number;
  height: number;
  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
  }
  getContext() {
    return {};
  }
  addEventListener() {}
  removeEventListener() {}
  convertToBlob() {
    return Promise.resolve(new Blob());
  }
}

describe('VideoCompositor init timeout', () => {
  it('rejects if Pixi renderer init hangs', async () => {
    const originalOffscreenCanvas = (globalThis as any).OffscreenCanvas;
    (globalThis as any).OffscreenCanvas = MockOffscreenCanvas;

    vi.useFakeTimers({ shouldAdvanceTime: true });
    const originalInit = Application.prototype.init;
    Application.prototype.init = vi.fn(() => new Promise(() => {
      // never resolves
    })) as any;

    try {
      const compositor = new VideoCompositor();
      const initPromise = compositor.init(1920, 1080, '#000', true);
      await vi.advanceTimersByTimeAsync(6000);
      await expect(initPromise).rejects.toThrow('timed out');
    } finally {
      Application.prototype.init = originalInit;
      (globalThis as any).OffscreenCanvas = originalOffscreenCanvas;
      vi.useRealTimers();
    }
  });
});
