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
    previewEffectQuality: 'ultra',
    setPreviewEffectsEnabled: vi.fn(),
    setPreviewEffectQuality: vi.fn(),
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
    applyTrackEffects: vi.fn(() => Promise.resolve(() => {})),
    applyMasterEffects: vi.fn(async () => false),
    hideStageBelowAdjustmentClips: vi.fn(),
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

  it('releases decoded video frames after present but preserves non-video effect output', async () => {
    // Regression: the post-present cleanup used to dispose `lastVideoFrame` on
    // EVERY active clip. For image/text/shape/solid clips that field is the
    // committed WebGPU effect output — the sprite's current texture resource and
    // the validity token for `nonVideoEffectCacheKey` — so nulling it made
    // applyEffectsToNonVideoClip's "skip reprocessing" check fail on every frame
    // and re-run the full rasterize + compute pipeline for static clips.
    const videoFrame = { close: vi.fn() };
    const imageFrame = { close: vi.fn() };
    const videoClip = {
      itemId: 'video',
      clipKind: 'video',
      lastVideoFrame: videoFrame,
    } as unknown as CompositorClip;
    const imageClip = {
      itemId: 'image',
      clipKind: 'image',
      lastVideoFrame: imageFrame,
      nonVideoEffectCacheKey: 'key',
    } as unknown as CompositorClip;

    const engine = new RenderingEngine();
    const { context } = makeContext({
      clips: [videoClip, imageClip],
      updateActiveClips: vi.fn(() => ({
        activeClips: [videoClip, imageClip],
        activeChanged: false,
      })),
    });

    await engine.renderFrame(100, undefined, context);

    // The decoded video frame is released once it has presented…
    expect(videoFrame.close).toHaveBeenCalled();
    expect(videoClip.lastVideoFrame).toBeNull();
    // …but the non-video effect output survives the frame, keeping the cache valid.
    expect(imageFrame.close).not.toHaveBeenCalled();
    expect(imageClip.lastVideoFrame).toBe(imageFrame);
  });

  it('re-renders the same frame when preview effect quality changes', async () => {
    const engine = new RenderingEngine();
    const { context } = makeContext({
      lastRenderedTimeUs: 100,
      previewEffectQuality: 'low',
    });

    await engine.renderFrame(100, { previewEffectQuality: 'high' }, context);

    expect(context.setPreviewEffectQuality).toHaveBeenCalledWith('high');
    expect(context.hideInactiveClipSprites).toHaveBeenCalledTimes(1);
  });
});
