import type { Application } from 'pixi.js';
import { toPixiBlendMode, type CompositorClip, type CompositorTrack } from './types';
import type { PreviewRenderOptions } from '../worker-rpc';
import { safeDispose } from '../utils';
import type { PreviewEffectQuality } from '~/utils/preview-effect-quality';

export interface RenderingEngineContext {
  app: Application;
  canvas: OffscreenCanvas | HTMLCanvasElement;
  width: number;
  height: number;
  clips: CompositorClip[];
  tracks: CompositorTrack[];
  lastRenderedTimeUs: number;
  stageSortDirty: boolean;
  activeSortDirty: boolean;
  contextLost: boolean;
  previewEffectsEnabled: boolean;
  previewEffectQuality: PreviewEffectQuality;
  setPreviewEffectsEnabled: (enabled: boolean) => void;
  setPreviewEffectQuality: (quality: PreviewEffectQuality) => void;
  applyVideoFrameCacheLimit: (limitMb: number | undefined) => void;
  abortInFlightResources: () => void;
  updateActiveClips: (
    timeUs: number,
    lastTimeUs: number,
  ) => {
    activeClips: CompositorClip[];
    activeChanged: boolean;
  };
  hideInactiveClipSprites: (activeClips: CompositorClip[]) => void;
  applyTrackState: (track: CompositorTrack) => void;
  processFrameSamples: (params: {
    activeClips: CompositorClip[];
    timeUs: number;
    monitorSyncMode: 'smooth' | 'balanced' | 'strict';
  }) => Promise<{ updatedClips: CompositorClip[] }>;
  sortStage: () => void;
  prepareAdjustmentClips: (activeClips: CompositorClip[]) => Promise<void>;
  applyShaderTransitions: (activeClips: CompositorClip[], timeUs: number) => Promise<void>;
  applyWebGpuClipEffects?: (clip: CompositorClip) => Promise<void>;
  applyTrackEffects: () => Promise<() => void>;
  /**
   * Renders the stage off-screen, runs the master WGSL effects over it, and
   * presents the processed frame as the only write to the visible canvas.
   * Returns false when there is nothing to apply (or processing failed) and
   * the caller must present the raw stage itself.
   */
  applyMasterEffects: () => Promise<boolean>;
  setStageSortDirty: (value: boolean) => void;
  setActiveSortDirty: (value: boolean) => void;
  setLastRenderedTimeUs: (value: number) => void;
}

export class RenderingEngine {
  public async renderFrame(
    timeUs: number,
    options: PreviewRenderOptions | undefined,
    context: RenderingEngineContext,
  ): Promise<OffscreenCanvas | HTMLCanvasElement | null> {
    if (!context.app || !context.canvas || !context.app.renderer) {
      return null;
    }

    context.applyVideoFrameCacheLimit(options?.videoFrameCacheMb);

    if (timeUs !== context.lastRenderedTimeUs) {
      context.abortInFlightResources();
    }

    const nextPreviewEffectsEnabled = options?.previewEffectsEnabled !== false;
    const previewEffectsChanged = context.previewEffectsEnabled !== nextPreviewEffectsEnabled;
    context.setPreviewEffectsEnabled(nextPreviewEffectsEnabled);
    const nextPreviewEffectQuality = options?.previewEffectQuality ?? 'ultra';
    const previewEffectQualityChanged = context.previewEffectQuality !== nextPreviewEffectQuality;
    context.setPreviewEffectQuality(nextPreviewEffectQuality);

    if (context.contextLost) {
      return null;
    }

    // Early-exit must also respect per-clip dirty flags so that text/shape/HUD
    // edits made while paused at the same time still trigger a redraw.
    const hasDirtyClip = context.clips.some(
      (clip) => clip.textDirty || clip.shapeDirty || clip.hudDirty,
    );

    if (
      timeUs === context.lastRenderedTimeUs &&
      !previewEffectsChanged &&
      !previewEffectQualityChanged &&
      !context.stageSortDirty &&
      !context.activeSortDirty &&
      !hasDirtyClip
    ) {
      return context.canvas;
    }

    let updatedClips: CompositorClip[] = [];
    let processingClips: CompositorClip[] = [];

    try {
      const { activeClips, activeChanged } = context.updateActiveClips(
        timeUs,
        context.lastRenderedTimeUs,
      );
      processingClips = activeClips;

      if (activeChanged) {
        context.setActiveSortDirty(true);
      }

      if (context.activeSortDirty) {
        activeClips.sort((a, b) => a.layer - b.layer || a.startUs - b.startUs);
        context.setActiveSortDirty(false);
      }

      // Hide everything not active before anything makes clips visible again. This
      // is the authoritative "off" pass; the tracker's incremental onDeactivate and
      // the video processor's range check still run, but this guarantees a clip the
      // playhead has moved off (including a transition's outgoing shadow clip) can
      // never linger on screen even if those incremental paths miss it.
      context.hideInactiveClipSprites(activeClips);

      for (const track of context.tracks) {
        track.container.alpha = track.opacity ?? 1;
        track.container.blendMode = toPixiBlendMode(track.blendMode);
        context.applyTrackState(track);
      }

      const samplesResult = await context.processFrameSamples({
        activeClips,
        timeUs,
        monitorSyncMode: options?.monitorSyncMode ?? 'balanced',
      });
      updatedClips = samplesResult.updatedClips;

      if (!context.app || !context.canvas || !context.app.renderer) {
        return null;
      }

      if (context.stageSortDirty) {
        context.sortStage();
        context.setStageSortDirty(false);
      }

      await context.prepareAdjustmentClips(activeClips);

      const stageChildren = [...context.app.stage.children];
      const previousStageVisibility = stageChildren.map((child) => child.visible);

      try {
        await context.applyShaderTransitions(activeClips, timeUs);

        if (!context.app || !context.canvas || !context.app.renderer) {
          return null;
        }

        // Track-level effects must be applied before the stage composites, so
        // process each effected track's container into a sprite now; the cleanup
        // restores the originals after the render.
        const restoreTrackEffects = await context.applyTrackEffects();
        try {
          if (!context.app || !context.canvas || !context.app.renderer) {
            return null;
          }
          context.setLastRenderedTimeUs(timeUs);
          // The canvas is displayed directly (transferControlToOffscreen), so
          // every frame must reach it with exactly one final render: drawing
          // the raw stage first and post-processing it in place would commit
          // an effect-less frame at each await inside the master pipeline.
          const presentedWithMasterEffects = await context.applyMasterEffects();
          if (!presentedWithMasterEffects) {
            if (!context.app || !context.canvas || !context.app.renderer) {
              return null;
            }
            context.app.renderer.render(context.app.stage);
          }
        } finally {
          restoreTrackEffects();
        }
      } finally {
        for (let i = 0; i < stageChildren.length; i += 1) {
          const child = stageChildren[i];
          if (!child || (child as { destroyed?: boolean }).destroyed) continue;
          child.visible = previousStageVisibility[i] ?? true;
        }
      }

      return context.canvas;
    } finally {
      const clipsToClean = new Set([...processingClips, ...updatedClips]);
      for (const clip of clipsToClean) {
        // Non-video clips (image/text/shape/solid) commit their WebGPU effect
        // output as `lastVideoFrame` and must keep it across frames: it is both
        // the sprite's current texture resource and the validity token of
        // `nonVideoEffectCacheKey` (ClipResourceManager.applyEffectsToNonVideoClip
        // early-exits only while it is set). Disposing it here made that cache
        // miss on every frame, re-running the full rasterize + compute pipeline
        // for static clips during playback. Only per-frame decoded video frames
        // are released after the present; the non-video output is disposed by
        // the next effect commit or by destroyClip.
        const holdsCommittedEffectOutput =
          clip.clipKind === 'image' ||
          clip.clipKind === 'text' ||
          clip.clipKind === 'shape' ||
          clip.clipKind === 'solid';
        if (!holdsCommittedEffectOutput && clip.lastVideoFrame) {
          safeDispose(clip.lastVideoFrame);
          clip.lastVideoFrame = null;
        }
        // Dispose the mask frame independently — a failed primary sample
        // leaves clip.lastVideoFrame null but the mask frame may still be set.
        if (clip.maskState?.lastVideoFrame) {
          safeDispose(clip.maskState.lastVideoFrame);
          clip.maskState.lastVideoFrame = null;
        }
      }
    }
  }
}
