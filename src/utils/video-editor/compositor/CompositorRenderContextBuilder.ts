import type { Application, Graphics, RenderTexture } from 'pixi.js';
import type { VideoClipEffect } from '~/timeline/types';
import type { CanvasFallbackRenderer } from './renderers/CanvasFallbackRenderer';
import type { ShapeRenderer } from './renderers/ShapeRenderer';
import type { TextRenderer } from './renderers/TextRenderer';
import type { ClipResourceManager } from './ClipResourceManager';
import type { EffectManager } from './EffectManager';
import type { FrameSampleOrchestrator } from './FrameSampleOrchestrator';
import type { LayoutApplier } from './LayoutApplier';
import type { RenderingEngineContext } from './RenderingEngine';
import type { ResourceManager } from './ResourceManager';
import type { StageManager } from './StageManager';
import type { StageTextureRenderer } from './StageTextureRenderer';
import type { TimelineActiveClipProcessor } from './TimelineActiveClipProcessor';
import type { TrackRuntimeManager } from './TrackRuntimeManager';
import type { TransitionManager } from './TransitionManager';
import type { TransitionRenderer } from './TransitionRenderer';
import type { VideoFrameCache } from './VideoFrameCache';
import type { CompositorClip } from './types';

export interface CompositorRenderState {
  width: number;
  height: number;
  clips: CompositorClip[];
  lastRenderedTimeUs: number;
  stageSortDirty: boolean;
  activeSortDirty: boolean;
  contextLost: boolean;
  previewEffectsEnabled: boolean;
  masterEffects: VideoClipEffect[] | null;
}

export interface CompositorRenderContextBuilderParams {
  app: Application;
  canvas: OffscreenCanvas | HTMLCanvasElement;
  state: CompositorRenderState;
  activeTrackerUpdate: (
    timeUs: number,
    lastTimeUs: number,
  ) => {
    activeClips: CompositorClip[];
    activeChanged: boolean;
  };
  hideInactiveClipSprites: (activeClips: CompositorClip[]) => void;
  prepareAdjustmentClips: (activeClips: CompositorClip[]) => void;
  getVideoSampleForClip: (params: {
    clip: CompositorClip;
    sampleTimeS: number;
    abortSignal?: AbortSignal;
  }) => Promise<unknown | null>;
  getClipById: (clipId: string) => CompositorClip | undefined;
  getPrevClipOnLayer: (clip: CompositorClip) => CompositorClip | null;
  getNextClipOnLayer: (clip: CompositorClip) => CompositorClip | null;
  setClipSpriteVisible: (clip: CompositorClip, visible: boolean) => boolean;
  getPreviewEffectsEnabled: () => boolean;
  setPreviewEffectsEnabled: (enabled: boolean) => void;
  setStageSortDirty: (value: boolean) => void;
  setActiveSortDirty: (value: boolean) => void;
  setLastRenderedTimeUs: (value: number) => void;
  resourceManager: ResourceManager;
  videoFrameCache: VideoFrameCache;
  effectManager: EffectManager;
  transitionManager: TransitionManager;
  clipResourceManager: ClipResourceManager;
  transitionRenderer: TransitionRenderer;
  stageTextureRenderer: StageTextureRenderer;
  stageManager: StageManager;
  frameSampleOrchestrator: FrameSampleOrchestrator;
  timelineActiveClipProcessor: TimelineActiveClipProcessor;
  canvasFallbackRenderer: CanvasFallbackRenderer;
  shapeRenderer: ShapeRenderer;
  textRenderer: TextRenderer;
  layoutApplier: LayoutApplier;
  trackRuntimeManager: TrackRuntimeManager;
  masterEffectFilters: Map<string, import('pixi.js').Filter>;
}

export class CompositorRenderContextBuilder {
  public build(params: CompositorRenderContextBuilderParams): RenderingEngineContext {
    const { app, canvas, state } = params;

    return {
      app,
      canvas,
      width: state.width,
      height: state.height,
      clips: state.clips,
      tracks: params.trackRuntimeManager.all,
      lastRenderedTimeUs: state.lastRenderedTimeUs,
      stageSortDirty: state.stageSortDirty,
      activeSortDirty: state.activeSortDirty,
      contextLost: state.contextLost,
      previewEffectsEnabled: state.previewEffectsEnabled,
      setPreviewEffectsEnabled: params.setPreviewEffectsEnabled,
      applyVideoFrameCacheLimit: (limitMb) => {
        params.videoFrameCache.applyLimitMb(limitMb);
      },
      abortInFlightResources: () => {
        params.resourceManager.abortInFlight();
      },
      updateActiveClips: params.activeTrackerUpdate,
      hideInactiveClipSprites: params.hideInactiveClipSprites,
      applyTrackState: (track) => {
        params.effectManager.applyTrackEffects(track, {
          previewEffectsEnabled: params.getPreviewEffectsEnabled(),
        });
      },
      processFrameSamples: ({ activeClips, timeUs: currentTimeUs }) =>
        params.frameSampleOrchestrator.process({
          activeClips,
          timeUs: currentTimeUs,
          width: state.width,
          height: state.height,
          activeClipProcessor: params.timelineActiveClipProcessor,
          syncTransitionFilter: (clip, clipTimeUs) =>
            params.transitionManager.syncTransitionFilter(
              clip,
              clipTimeUs,
              params.getPreviewEffectsEnabled(),
            ),
          computeTransitionOpacity: (clip, clipTimeUs) =>
            params.transitionManager.computeTransitionOpacity(
              clip,
              clipTimeUs,
              params.getPreviewEffectsEnabled(),
            ),
          applyClipEffects: (clip) => {
            params.effectManager.applyClipEffects(clip, {
              previewEffectsEnabled: params.getPreviewEffectsEnabled(),
            });
          },
          drawHudClip: (clip, timeUs) => params.canvasFallbackRenderer.drawHudClip(clip, timeUs),
          drawShapeClip: (clip, size) => {
            params.shapeRenderer.draw({
              graphics: clip.sprite as Graphics,
              type: clip.shapeType ?? 'square',
              fill: clip.fillColor ?? '#ffffff',
              stroke: clip.strokeColor ?? '#000000',
              strokeWidth: clip.strokeWidth ?? 0,
              config: clip.shapeConfig ?? {},
              canvasWidth: size.width,
              canvasHeight: size.height,
            });
          },
          drawTextClip: (clip, size) => {
            params.textRenderer.draw(clip, size.width, size.height);
            params.layoutApplier.applyTextLayout(clip);
          },
          createAbortController: (key) => params.resourceManager.createAbortController(key),
          removeAbortController: (key) => params.resourceManager.removeAbortController(key),
          getVideoSampleForClip: params.getVideoSampleForClip,
          getPrevClipOnLayer: params.getPrevClipOnLayer,
          updateClipTextureFromSample: (sample, clip) =>
            params.clipResourceManager.updateClipTextureFromSample(sample, clip),
          setClipSpriteVisible: params.setClipSpriteVisible,
        }),
      sortStage: () => {
        params.stageManager.sortStage({
          app,
          tracks: params.trackRuntimeManager.all,
          getClipById: params.getClipById,
          getTrackById: (trackId) => params.trackRuntimeManager.getById(trackId),
        });
      },
      prepareAdjustmentClips: params.prepareAdjustmentClips,
      applyShaderTransitions: (activeClips, currentTimeUs) =>
        params.transitionRenderer.applyShaderTransitions(activeClips, currentTimeUs, {
          app,
          clips: state.clips,
          width: state.width,
          height: state.height,
          transitionManager: params.transitionManager,
          stageTextureRenderer: params.stageTextureRenderer,
          getTrackById: (trackId) => params.trackRuntimeManager.getById(trackId),
          getActiveTransitionState: (clip, timeUs) =>
            params.transitionManager.getActiveTransitionState(
              clip,
              timeUs,
              params.getPreviewEffectsEnabled(),
            ) as {
              opacity: number;
              progress: number;
              mode?: string;
            } | null,
          ensureTransitionRenderTexture: (texture: RenderTexture | null) =>
            params.clipResourceManager.ensureTransitionRenderTexture(texture),
          findPrevClipOnLayer: params.getPrevClipOnLayer,
          findNextClipOnLayer: params.getNextClipOnLayer,
          createAbortController: (key) => params.resourceManager.createAbortController(key),
          removeAbortController: (key) => params.resourceManager.removeAbortController(key),
          getVideoSampleForClip: params.getVideoSampleForClip,
          updateClipTextureFromSample: (sample, clip) =>
            params.clipResourceManager.updateClipTextureFromSample(sample, clip),
        }),
      applyMasterEffects: () => {
        params.effectManager.applyMasterEffects(
          app.stage,
          state.masterEffects,
          params.masterEffectFilters,
          { previewEffectsEnabled: params.getPreviewEffectsEnabled() },
        );
      },
      setStageSortDirty: params.setStageSortDirty,
      setActiveSortDirty: params.setActiveSortDirty,
      setLastRenderedTimeUs: params.setLastRenderedTimeUs,
    };
  }
}
