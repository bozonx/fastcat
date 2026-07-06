import { Sprite, Texture, type Application, type Graphics, type RenderTexture } from 'pixi.js';
import type { VideoClipEffect } from '~/timeline/types';
import { buildEffectSpecs } from '~/effects';
import type { CanvasFallbackRenderer } from './renderers/CanvasFallbackRenderer';
import type { ShapeRenderer } from './renderers/ShapeRenderer';
import type { TextRenderer } from './renderers/TextRenderer';
import type { ClipResourceManager } from './ClipResourceManager';
import type { EffectManager } from './EffectManager';
import type { FrameSampleOrchestrator } from './FrameSampleOrchestrator';
import type { LayoutApplier } from './LayoutApplier';
import { resolveClipAnimationOverlay } from './AnimationOverlay';
import { createDevLogger } from '~/utils/dev-logger';
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
import type { PreviewEffectQuality } from '~/utils/preview-effect-quality';

const log = createDevLogger('CompositorRenderContextBuilder');

export interface CompositorRenderState {
  width: number;
  height: number;
  clips: CompositorClip[];
  lastRenderedTimeUs: number;
  stageSortDirty: boolean;
  activeSortDirty: boolean;
  contextLost: boolean;
  previewEffectsEnabled: boolean;
  previewEffectQuality: PreviewEffectQuality;
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
  prepareAdjustmentClips: (activeClips: CompositorClip[]) => Promise<void>;
  getVideoSampleForClip: (params: {
    clip: CompositorClip;
    sampleTimeS: number;
    timelineTimeUs?: number;
    monitorSyncMode?: 'smooth' | 'balanced' | 'strict';
    abortSignal?: AbortSignal;
  }) => Promise<unknown | null>;
  getClipById: (clipId: string) => CompositorClip | undefined;
  getPrevClipOnLayer: (clip: CompositorClip) => CompositorClip | null;
  getNextClipOnLayer: (clip: CompositorClip) => CompositorClip | null;
  setClipSpriteVisible: (clip: CompositorClip, visible: boolean) => boolean;
  getPreviewEffectsEnabled: () => boolean;
  setPreviewEffectsEnabled: (enabled: boolean) => void;
  setPreviewEffectQuality: (quality: PreviewEffectQuality) => void;
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
      previewEffectQuality: state.previewEffectQuality,
      setPreviewEffectsEnabled: params.setPreviewEffectsEnabled,
      setPreviewEffectQuality: params.setPreviewEffectQuality,
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
      processFrameSamples: ({ activeClips, timeUs: currentTimeUs, monitorSyncMode }) =>
        params.frameSampleOrchestrator.process({
          activeClips,
          timeUs: currentTimeUs,
          monitorSyncMode,
          width: state.width,
          height: state.height,
          activeClipProcessor: params.timelineActiveClipProcessor,
          resolveClipOverlays: (activeClips, clipTimeUs) => {
            for (const clip of activeClips) {
              resolveClipAnimationOverlay(clip, clipTimeUs);
              // Video clips re-apply layout when their next sample lands; other
              // kinds are laid out once, so re-run layout each frame when they
              // carry an animated transform.
              if (clip.animatedTransform && clip.clipKind !== 'video') {
                params.layoutApplier.applyClipLayoutForCurrentSource(clip);
              }
            }
          },
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
          applyWebGpuClipEffects: (clip) =>
            params.clipResourceManager.applyEffectsToNonVideoClip(
              clip,
              params.getPreviewEffectsEnabled(),
            ),
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
              snapToPixelGrid: clip.snapToPixelGrid,
              transform: clip.transform,
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
            params.clipResourceManager.updateClipTextureFromSample(
              sample,
              clip,
              params.getPreviewEffectsEnabled(),
            ),
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
      prepareAdjustmentClips: async (activeClips) => {
        await params.prepareAdjustmentClips(activeClips);
      },
      applyShaderTransitions: (activeClips, currentTimeUs) =>
        params.transitionRenderer.applyShaderTransitions(activeClips, currentTimeUs, {
          app,
          clips: state.clips,
          width: state.width,
          height: state.height,
          previewEffectQuality: state.previewEffectQuality,
          computeRunner: params.clipResourceManager.getComputeRunner()!,
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
            params.clipResourceManager.updateClipTextureFromSample(
              sample,
              clip,
              params.getPreviewEffectsEnabled(),
            ),
        }),
      // Track-level WGSL effects. Mirrors the master path but scoped to one
      // track: render the track's container in isolation to a texture, run the
      // shared compute runner over those pixels, then swap the track's content
      // for the processed sprite so it still composites with the track's own
      // alpha/blendMode. Runs before the main stage render; the returned cleanup
      // restores the original children and releases per-frame GPU resources.
      applyTrackEffects: async (): Promise<() => void> => {
        const noop = () => {};
        if (!params.getPreviewEffectsEnabled()) return noop;

        const runner = params.clipResourceManager.getComputeRunner();
        if (!runner?.isReady()) return noop;

        const cleanups: Array<() => void> = [];

        for (const track of params.trackRuntimeManager.all) {
          const specs = buildEffectSpecs(track.effects ?? undefined);
          if (!specs || specs.length === 0) continue;

          const container = track.container;
          // Nothing visible on this track this frame → no pixels to process.
          if (!container || !container.children.some((child) => child.visible)) {
            continue;
          }

          let bitmap: ImageBitmap | null = null;
          try {
            // Render the track content with its composite alpha/blendMode
            // neutralised — those are applied once at the final stage composite
            // (the processed sprite lives inside this same container), so baking
            // them into the texture too would double them.
            const prevAlpha = container.alpha;
            const prevBlend = container.blendMode;
            container.alpha = 1;
            container.blendMode = 'normal';
            try {
              // Capture over transparent, not the project background: the
              // processed sprite must keep the track content's alpha so it
              // still composites over lower tracks (and the track's own
              // opacity/blend don't tint baked-in background pixels). Mirrors
              // the native engine, which renders track members via
              // Scene::isolated with a TRANSPARENT background.
              bitmap = await params.stageTextureRenderer.renderDisplayObjectToBitmapForcedVisible(
                container,
                { transparent: true },
              );
            } finally {
              container.alpha = prevAlpha;
              container.blendMode = prevBlend;
            }

            if (!bitmap) continue;

            const processed = await runner.applyEffects(bitmap, specs);
            if (!processed) continue;

            // Hide the real children and drop a single processed sprite into the
            // container. The container keeps its real alpha/blendMode, so it
            // composites onto the stage exactly as before — just with the
            // effect-processed pixels.
            const children = [...container.children];
            const prevVisible = children.map((child) => child.visible);
            for (const child of children) child.visible = false;

            const texture = Texture.from(processed);
            const sprite = new Sprite(texture);
            // applyEffects pads symmetrically so blur/bloom can bleed past the
            // frame; centre the result on the track so content stays aligned.
            sprite.x = (state.width - processed.width) / 2;
            sprite.y = (state.height - processed.height) / 2;
            container.addChild(sprite);

            cleanups.push(() => {
              try {
                container.removeChild(sprite);
              } catch {
                // ignore
              }
              sprite.destroy();
              texture.destroy(true);
              (processed as { close?: () => void }).close?.();
              for (let i = 0; i < children.length; i += 1) {
                const child = children[i];
                if (child && !(child as { destroyed?: boolean }).destroyed) {
                  child.visible = prevVisible[i] ?? true;
                }
              }
            });
          } catch (err) {
            log.warn('[Compositor] Track WebGPU effects failed:', err);
          } finally {
            bitmap?.close();
          }
        }

        if (cleanups.length === 0) return noop;
        return () => {
          for (const cleanup of cleanups) {
            try {
              cleanup();
            } catch {
              // ignore
            }
          }
        };
      },
      applyMasterEffects: async (): Promise<boolean> => {
        const previewEffectsEnabled = params.getPreviewEffectsEnabled();
        if (!previewEffectsEnabled) {
          params.effectManager.applyMasterEffects(
            app.stage,
            state.masterEffects,
            params.masterEffectFilters,
            { previewEffectsEnabled: false },
          );
          return false;
        }

        const masterSpecs = buildEffectSpecs(state.masterEffects ?? undefined);
        const runner = params.clipResourceManager.getComputeRunner();
        if (!masterSpecs || masterSpecs.length === 0 || !runner?.isReady()) {
          return false;
        }

        try {
          // Capture the stage off-screen: the visible canvas must only ever
          // receive the final processed frame (see RenderingEngine).
          const bitmap = await params.stageTextureRenderer.renderDisplayObjectToBitmapForcedVisible(
            app.stage,
          );
          try {
            const processed = await runner.applyEffects(bitmap, masterSpecs);
            if (!processed) {
              return false;
            }

            const texture = Texture.from(processed);
            const sprite = new Sprite(texture);
            // applyEffects pads its output symmetrically (so blur/bloom can bleed
            // past the frame), so `processed` can be larger than the canvas.
            // Center it so the original content stays aligned with the canvas.
            sprite.x = (state.width - processed.width) / 2;
            sprite.y = (state.height - processed.height) / 2;
            try {
              if (!app.renderer) {
                return false;
              }
              app.renderer.render({ container: sprite, clear: true });
            } finally {
              // The sprite, its texture and the processed bitmap are recreated
              // every frame; release them so playback with a master effect does
              // not leak a GPU texture + ImageBitmap per frame.
              sprite.destroy();
              texture.destroy(true);
              (processed as { close?: () => void }).close?.();
            }
            return true;
          } finally {
            bitmap.close();
          }
        } catch (err) {
          log.warn('[Compositor] Master WebGPU effects failed:', err);
          return false;
        }
      },
      setStageSortDirty: params.setStageSortDirty,
      setActiveSortDirty: params.setActiveSortDirty,
      setLastRenderedTimeUs: params.setLastRenderedTimeUs,
    };
  }
}
