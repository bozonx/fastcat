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

    context.setPreviewEffectsEnabled(options?.previewEffectsEnabled !== false);

    if (context.contextLost) {
      return null;
    }

    if (
      timeUs === context.lastRenderedTimeUs &&
      !context.stageSortDirty &&
      !context.activeSortDirty
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
      await context.applyShaderTransitions(activeClips, timeUs);

      if (!context.app || !context.canvas || !context.app.renderer) {
        return null;
      }

      context.setLastRenderedTimeUs(timeUs);
      context.applyMasterEffects();
      context.app.renderer.render(context.app.stage);

      return context.canvas;
    } finally {
      const clipsToClean = updatedClips.length > 0 ? updatedClips : processingClips;
      for (const clip of clipsToClean) {
        if (!clip.lastVideoFrame) {
          continue;
        }

        safeDispose(clip.lastVideoFrame);
        clip.lastVideoFrame = null;
      }
    }
  }
}
