import type { Application } from 'pixi.js';
import type { CompositorClip, CompositorTrack } from './types';
import type { PreviewRenderOptions } from '../worker-rpc';
import { safeDispose } from '../utils';

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
  setPreviewEffectsEnabled: (enabled: boolean) => void;
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
  }) => Promise<{ updatedClips: CompositorClip[] }>;
  sortStage: () => void;
  prepareAdjustmentClips: (activeClips: CompositorClip[]) => void;
  applyShaderTransitions: (activeClips: CompositorClip[], timeUs: number) => Promise<void>;
  applyMasterEffects: () => void;
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
        track.container.blendMode = track.blendMode ?? 'normal';
        context.applyTrackState(track);
      }

      const samplesResult = await context.processFrameSamples({
        activeClips,
        timeUs,
      });
      updatedClips = samplesResult.updatedClips;

      if (!context.app || !context.canvas || !context.app.renderer) {
        return null;
      }

      if (context.stageSortDirty) {
        context.sortStage();
        context.setStageSortDirty(false);
      }

      context.prepareAdjustmentClips(activeClips);

      const stageChildren = [...context.app.stage.children];
      const previousStageVisibility = stageChildren.map((child) => child.visible);

      try {
        await context.applyShaderTransitions(activeClips, timeUs);

        if (!context.app || !context.canvas || !context.app.renderer) {
          return null;
        }

        context.setLastRenderedTimeUs(timeUs);
        context.applyMasterEffects();
        context.app.renderer.render(context.app.stage);
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
        if (clip.lastVideoFrame) {
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
