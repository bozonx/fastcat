import { afterEach, describe, expect, it, vi } from 'vitest';
import { VideoCompositor } from '~/utils/video-editor/VideoCompositor';
import { VIDEO_CORE_LIMITS } from '~/utils/constants';

function defer<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('VideoCompositor op queue (render↔mutation serialization)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not run a timeline mutation while a render is in flight', async () => {
    const compositor = new VideoCompositor() as any;
    compositor.app = {};
    compositor.canvas = {};

    const renderDeferred = defer<null>();
    compositor.renderingEngine = { renderFrame: vi.fn(() => renderDeferred.promise) };
    compositor.updateTimelineLayoutLocked = vi.fn(() => 7);

    const renderPromise = compositor.renderFrame(0);
    const updatePromise = compositor.updateTimelineLayout([]);

    // Render has grabbed the queue and is awaiting; the mutation must wait.
    await flush();
    expect(compositor.renderingEngine.renderFrame).toHaveBeenCalledTimes(1);
    expect(compositor.updateTimelineLayoutLocked).not.toHaveBeenCalled();

    // Once the render settles, the queued mutation runs.
    renderDeferred.resolve(null);
    await renderPromise;
    await expect(updatePromise).resolves.toBe(7);
    expect(compositor.updateTimelineLayoutLocked).toHaveBeenCalledTimes(1);
  });

  it('watchdog aborts a stalled render so queued edits are released', async () => {
    vi.useFakeTimers();
    const compositor = new VideoCompositor() as any;
    compositor.app = {};
    compositor.canvas = {};

    // A render that never resolves on its own — only a cooperative abort frees it.
    const renderDeferred = defer<null>();
    compositor.renderingEngine = { renderFrame: vi.fn(() => renderDeferred.promise) };
    compositor.resourceManager = {
      abortInFlight: vi.fn(() => renderDeferred.resolve(null)),
    };
    compositor.updateTimelineLayoutLocked = vi.fn(() => 1);

    const renderPromise = compositor.renderFrame(0);
    const updatePromise = compositor.updateTimelineLayout([]);

    await vi.advanceTimersByTimeAsync(VIDEO_CORE_LIMITS.OP_QUEUE_WATCHDOG_MS + 5);

    expect(compositor.resourceManager.abortInFlight).toHaveBeenCalled();
    await renderPromise;
    await expect(updatePromise).resolves.toBe(1);
    expect(compositor.updateTimelineLayoutLocked).toHaveBeenCalledTimes(1);
  });

  it('destroy() drains the in-flight render before tearing down resources', async () => {
    const compositor = new VideoCompositor() as any;
    compositor.app = null;
    compositor.canvas = null;
    compositor.videoFrameCache = { clear: vi.fn() };
    compositor.transitionRenderer = { destroy: vi.fn() };
    compositor.stageTextureRenderer = null;
    compositor.clearClipsLocked = vi.fn();

    const renderDeferred = defer<null>();
    compositor.app = {};
    compositor.canvas = {};
    compositor.renderingEngine = { renderFrame: vi.fn(() => renderDeferred.promise) };
    const renderPromise = compositor.renderFrame(0);
    await flush();

    // Reset app/canvas to null so destroy()'s pixi teardown is skipped in the test.
    compositor.app = null;
    compositor.canvas = null;

    const destroyPromise = compositor.destroy();
    await flush();
    // Teardown must wait for the render still holding the queue.
    expect(compositor.clearClipsLocked).not.toHaveBeenCalled();

    renderDeferred.resolve(null);
    await renderPromise;
    await destroyPromise;
    expect(compositor.clearClipsLocked).toHaveBeenCalledTimes(1);
    expect(compositor.disposed).toBe(true);
  });

  it('rejects renders/mutations after disposal', async () => {
    const compositor = new VideoCompositor() as any;
    compositor.app = {};
    compositor.canvas = {};
    compositor.videoFrameCache = { clear: vi.fn() };
    compositor.transitionRenderer = { destroy: vi.fn() };
    compositor.stageTextureRenderer = null;
    compositor.clearClipsLocked = vi.fn();
    compositor.renderingEngine = { renderFrame: vi.fn(() => Promise.resolve(null)) };
    compositor.updateTimelineLayoutLocked = vi.fn(() => 3);
    compositor.maxDurationUs = 42;

    compositor.app = null;
    compositor.canvas = null;
    await compositor.destroy();

    compositor.app = {};
    compositor.canvas = {};
    expect(await compositor.renderFrame(0)).toBeNull();
    expect(await compositor.updateTimelineLayout([])).toBe(42);
    expect(compositor.renderingEngine.renderFrame).not.toHaveBeenCalled();
    expect(compositor.updateTimelineLayoutLocked).not.toHaveBeenCalled();
  });
});
