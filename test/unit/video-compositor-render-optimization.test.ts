import { describe, expect, it, vi } from 'vitest';

import { VideoCompositor } from '../../src/utils/video-editor/VideoCompositor';

describe('VideoCompositor render optimization', () => {
  function createCompositor() {
    const compositor = new VideoCompositor() as any;
    const app = {
      render: vi.fn(),
      stage: {
        children: [] as any[],
      },
      ticker: {
        stop: vi.fn(),
      },
    };

    compositor.app = app;
    compositor.canvas = { id: 'canvas' } as any;
    compositor.clips = [];
    compositor.clipById = new Map();
    compositor.lastRenderedTimeUs = 1_000;
    compositor.stageSortDirty = false;
    compositor.activeSortDirty = false;

    return { compositor, app };
  }

  it('skips rendering when time is unchanged and no dirty flags', async () => {
    const { compositor, app } = createCompositor();

    const result = await compositor.renderFrame(1_000);

    expect(result).toEqual({ id: 'canvas' });
    expect(app.render).not.toHaveBeenCalled();
  });

  it('renders when stage sort is dirty even if time is unchanged', async () => {
    const { compositor, app } = createCompositor();
    compositor.stageSortDirty = true;

    await compositor.renderFrame(1_000);

    expect(app.render).toHaveBeenCalledTimes(1);
  });
});
