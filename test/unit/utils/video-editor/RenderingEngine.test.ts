/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';

import { RenderingEngine } from '~/utils/video-editor/compositor/RenderingEngine';
import type { RenderingEngineContext } from '~/utils/video-editor/compositor/RenderingEngine';
import type { CompositorClip } from '~/utils/video-editor/compositor/types';

function makeClip(id: string): CompositorClip {
  return { itemId: id } as unknown as CompositorClip;
}

function makeContext(overrides: Partial<RenderingEngineContext> = {}): {
  context: RenderingEngineContext;
  callOrder: string[];
  activeClips: CompositorClip[];
} {
  const callOrder: string[] = [];
  const activeClips = [makeClip('active')];

  const app = {
    renderer: { render: vi.fn() },
    stage: { children: [] as unknown[] },
  };

  const context: RenderingEngineContext = {
    app: app as unknown as RenderingEngineContext['app'],
    canvas: {} as RenderingEngineContext['canvas'],
    width: 100,
    height: 100,
    clips: [makeClip('active'), makeClip('inactive')],
    tracks: [],
    lastRenderedTimeUs: 0,
    stageSortDirty: false,
    activeSortDirty: false,
    contextLost: false,
    previewEffectsEnabled: true,
    setPreviewEffectsEnabled: vi.fn(),
    applyVideoFrameCacheLimit: vi.fn(),
    abortInFlightResources: vi.fn(),
    updateActiveClips: vi.fn(() => ({ activeClips, activeChanged: false })),
    hideInactiveClipSprites: vi.fn(() => {
      callOrder.push('hideInactiveClipSprites');
    }),
    applyTrackState: vi.fn(),
    processFrameSamples: vi.fn(() => {
      callOrder.push('processFrameSamples');
      return Promise.resolve({ updatedClips: [] });
    }),
    sortStage: vi.fn(),
    prepareAdjustmentClips: vi.fn(),
    applyShaderTransitions: vi.fn(() => Promise.resolve()),
    applyMasterEffects: vi.fn(),
    setStageSortDirty: vi.fn(),
    setActiveSortDirty: vi.fn(),
    setLastRenderedTimeUs: vi.fn(),
    ...overrides,
  };

  return { context, callOrder, activeClips };
}

describe('RenderingEngine', () => {
  it('hides inactive clip sprites every frame, before any clip is made visible again', async () => {
    // Regression guard for the "clip stranded in the monitor" bug: a non-video clip
    // (image/text/shape/hud) or a transition's outgoing shadow clip can be left
    // visible when the playhead moves off it, because the render is incremental and
    // only the tracker's onDeactivate / the video range-check normally hide clips.
    // The authoritative off-pass must run on the way to presenting the frame, and it
    // must run BEFORE processFrameSamples (which re-shows the clips needed this frame),
    // otherwise it would clobber the legitimately visible ones.
    const engine = new RenderingEngine();
    const { context, callOrder, activeClips } = makeContext();

    const result = await engine.renderFrame(100, undefined, context);

    expect(result).toBe(context.canvas);
    expect(context.hideInactiveClipSprites).toHaveBeenCalledTimes(1);
    expect(context.hideInactiveClipSprites).toHaveBeenCalledWith(activeClips);
    expect(callOrder).toEqual(['hideInactiveClipSprites', 'processFrameSamples']);
  });

  it('still runs the off-pass when the active set did not change (stale shadow cleanup)', async () => {
    // The shadow/transition window can open and close without the active set changing,
    // so the off-pass cannot be gated on activeChanged — it must fire on every rendered
    // frame so a shadow clip whose window just ended gets hidden.
    const engine = new RenderingEngine();
    const { context } = makeContext({
      updateActiveClips: vi.fn(() => ({ activeClips: [makeClip('active')], activeChanged: false })),
    });

    await engine.renderFrame(100, undefined, context);

    expect(context.hideInactiveClipSprites).toHaveBeenCalledTimes(1);
  });
});
