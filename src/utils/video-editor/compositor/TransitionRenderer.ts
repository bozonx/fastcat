import { createDevLogger } from '~/utils/dev-logger';
import { TICKS_PER_MILLISECOND, TICKS_PER_SECOND } from '~/utils/time';
import { compositorPerfStats } from './CompositorPerfStats';
import { ImageSource, Sprite, Texture, type Application, type RenderTexture } from 'pixi.js';
import {
  applyTransitionCurve,
  DEFAULT_TRANSITION_MODE,
  getTransitionCurveSpeed,
  normalizeTransitionParams,
} from '~/transitions';
import type { TransitionManager } from './TransitionManager';
import { toPixiBlendMode, type CompositorClip, type CompositorTrack } from './types';
import type { StageTextureRenderer } from './StageTextureRenderer';
import type { PreviewEffectQuality } from '~/utils/preview-effect-quality';
import type { WebGpuComputeRunner } from './WebGpuComputeRunner';
const log = createDevLogger('TransitionRenderer');

/** Minimum usable handle in canonical timeline ticks (~1 ms). */
const MIN_SOURCE_HANDLE_TICKS = TICKS_PER_MILLISECOND;

export interface TransitionRendererParams {
  app: Application;
  clips: CompositorClip[];
  width: number;
  height: number;
  previewEffectQuality?: PreviewEffectQuality;
  computeRunner: WebGpuComputeRunner;
  textureToBitmap?: (texture: RenderTexture) => Promise<ImageBitmap>;
  transitionManager: TransitionManager;
  stageTextureRenderer: StageTextureRenderer;
  getTrackById: (trackId: string) => CompositorTrack | undefined;
  getActiveTransitionState: (
    clip: CompositorClip,
    timeTicks: number,
  ) => {
    opacity: number;
    progress: number;
    mode?: string;
    manifest?: { renderMode?: string } | null;
    transition?: {
      type: string;
      mode?: string;
      durationTicks?: number;
      params?: Record<string, unknown>;
    };
    edge?: 'in' | 'out';
    curve?: string;
  } | null;
  ensureTransitionRenderTexture: (texture: RenderTexture | null) => RenderTexture;
  findPrevClipOnLayer: (clip: CompositorClip) => CompositorClip | null;
  findNextClipOnLayer: (clip: CompositorClip) => CompositorClip | null;
  createAbortController: (key: string) => AbortController;
  removeAbortController?: (key: string) => void;
  getVideoSampleForClip: (params: {
    clip: CompositorClip;
    sampleTimeS: number;
    timelineTimeTicks?: number;
    abortSignal?: AbortSignal;
  }) => Promise<unknown | null>;
  updateClipTextureFromSample: (sample: unknown, clip: CompositorClip) => Promise<void>;
}

export class TransitionRenderer {
  // Reusable sprite + ImageSource + Texture for blitting the transition result
  // into the clip's output texture. All three are kept on the instance so we
  // don't allocate GPU-backed objects every frame of every transition.
  private blitSprite: Sprite | null = null;
  private blitSource: ImageSource | null = null;
  private blitTexture: Texture | null = null;

  public destroy() {
    this.blitSprite?.destroy();
    this.blitSprite = null;
    this.blitTexture?.destroy(true);
    this.blitTexture = null;
    this.blitSource = null;
  }

  public async applyShaderTransitions(
    active: CompositorClip[],
    timeTicks: number,
    params: TransitionRendererParams,
  ) {
    for (const clip of params.clips) {
      if (clip.transitionSprite) {
        clip.transitionSprite.visible = false;
        clip.transitionSprite.filters = null;
      }
    }

    for (const clip of active) {
      const state = params.getActiveTransitionState(clip, timeTicks);
      if (
        !state ||
        state.manifest?.renderMode !== 'shader' ||
        !state.transition ||
        !params.computeRunner.isReady()
      ) {
        continue;
      }

      const manifest = state.manifest as import('~/transitions').TransitionManifest;
      if (!manifest.toTransitionSpec) {
        continue;
      }

      const mode = state.transition?.mode ?? DEFAULT_TRANSITION_MODE;
      if (mode !== 'adjacent' && mode !== 'background' && mode !== 'transparent') {
        continue;
      }

      clip.transitionFromTexture = params.ensureTransitionRenderTexture(
        clip.transitionFromTexture ?? null,
      );
      clip.transitionToTexture = params.ensureTransitionRenderTexture(
        clip.transitionToTexture ?? null,
      );
      clip.transitionOutputTexture = params.ensureTransitionRenderTexture(
        clip.transitionOutputTexture ?? null,
      );

      if (clip.sprite) {
        clip.sprite.visible = false;
      }
      params.stageTextureRenderer.renderSingleClipToTexture(clip, clip.transitionToTexture, true);

      const fromTexture = clip.transitionFromTexture;
      let prevClip: CompositorClip | null = null;

      if (mode === 'background') {
        params.stageTextureRenderer.renderLowerLayersToTexture(clip.layer, fromTexture);
      } else if (mode === 'transparent') {
        params.stageTextureRenderer.renderLowerLayersToTexture(
          Number.NEGATIVE_INFINITY,
          fromTexture,
        );
      } else {
        prevClip =
          state.edge === 'in' ? params.findPrevClipOnLayer(clip) : params.findNextClipOnLayer(clip);

        if (!prevClip) {
          // If no adjacent clip is found (e.g., at the end of the track),
          // fallback to rendering lower layers so we can fade to/from background.
          params.stageTextureRenderer.renderLowerLayersToTexture(clip.layer, fromTexture);
        } else {
          const transitionOffsetTicks = Math.max(
            0,
            state.edge === 'in' ? timeTicks - clip.startTicks : clip.endTicks - timeTicks,
          );
          const rendered = await this.renderTransitionClipToTexture(prevClip, fromTexture, {
            transitionOffsetTicks,
            isNextClip: state.edge === 'out',
            timelineTimeTicks: timeTicks,
            stageTextureRenderer: params.stageTextureRenderer,
            createAbortController: params.createAbortController,
            removeAbortController: params.removeAbortController,
            getVideoSampleForClip: params.getVideoSampleForClip,
            updateClipTextureFromSample: params.updateClipTextureFromSample,
          });
          if (!rendered) {
            // If rendering the peer clip failed, also fallback to background
            params.stageTextureRenderer.renderLowerLayersToTexture(clip.layer, fromTexture);
          }
        }
      }

      let shaderToTexture = clip.transitionToTexture;
      let shaderFromTexture = fromTexture;

      if (state.edge === 'out') {
        shaderToTexture = fromTexture;
        shaderFromTexture = clip.transitionToTexture;
      }

      const normalizedParams =
        (normalizeTransitionParams(state.transition.type, state.transition.params) as Record<
          string,
          unknown
        >) ?? {};
      const spec = manifest.toTransitionSpec(
        normalizedParams,
        (state.transition.durationTicks ?? 0) / TICKS_PER_SECOND,
        {
          isPlaying: true,
          previewBlurQuality: params.previewEffectQuality,
          idleSettled: false,
        },
      );
      const curve = state.curve as import('~/transitions').TransitionCurve;
      const progress = applyTransitionCurve(state.progress, curve, normalizedParams);
      const speed = getTransitionCurveSpeed(state.progress, curve, normalizedParams);

      try {
        const renderedOnGpu =
          typeof params.computeRunner.applyTransitionToTexture === 'function' &&
          params.computeRunner.applyTransitionToTexture({
            from: shaderFromTexture,
            to: shaderToTexture,
            output: clip.transitionOutputTexture,
            spec,
            progress,
            speed,
          });
        if (renderedOnGpu) {
          compositorPerfStats.onGpuComputePath('transition', 'zero-copy');
          this.commitTransitionOutput(clip, params, prevClip, mode);
          continue;
        }
      } catch (error) {
        log.warn('[VideoCompositor] WebGPU texture transition failed:', error);
      }

      let fromBitmap: ImageBitmap | null = null;
      let toBitmap: ImageBitmap | null = null;
      let processed: ImageBitmap | null = null;
      try {
        fromBitmap = params.textureToBitmap
          ? await params.textureToBitmap(shaderFromTexture)
          : await params.stageTextureRenderer.renderTextureToBitmap(shaderFromTexture);
        toBitmap = params.textureToBitmap
          ? await params.textureToBitmap(shaderToTexture)
          : await params.stageTextureRenderer.renderTextureToBitmap(shaderToTexture);
        processed = await params.computeRunner.applyTransition({
          from: fromBitmap,
          to: toBitmap,
          spec,
          progress,
          speed,
        });
        if (!processed) continue;
        compositorPerfStats.onGpuComputePath('transition', 'bitmap-fallback');

        // Reuse cached ImageSource + Texture + Sprite to avoid per-frame GPU allocations.
        if (!this.blitSource) {
          this.blitSource = new ImageSource({
            resource: processed as unknown as OffscreenCanvas,
          });
          this.blitTexture = new Texture({ source: this.blitSource });
          this.blitSprite = new Sprite(this.blitTexture);
        } else {
          const w = processed.width;
          const h = processed.height;
          if (this.blitSource.width !== w || this.blitSource.height !== h) {
            this.blitSource.resize(w, h);
          }
          (this.blitSource as { resource?: unknown }).resource = processed;
          this.blitSource.update();
        }
        const outputSprite = this.blitSprite!;
        outputSprite.width = params.width;
        outputSprite.height = params.height;
        params.app.renderer.render({
          container: outputSprite,
          target: clip.transitionOutputTexture,
          clear: true,
        });
      } catch (error) {
        log.warn('[VideoCompositor] WebGPU transition failed:', error);
        continue;
      } finally {
        // The sprite, texture, and image source are reused next frame.
        // Only the per-frame bitmaps are released.
        fromBitmap?.close();
        toBitmap?.close();
        processed?.close();
      }

      this.commitTransitionOutput(clip, params, prevClip, mode);
    }
  }

  private commitTransitionOutput(
    clip: CompositorClip,
    params: TransitionRendererParams,
    prevClip: CompositorClip | null,
    mode: string,
  ): void {
    const transitionSprite = params.stageTextureRenderer.ensureTransitionSprite(clip);
    transitionSprite.texture = clip.transitionOutputTexture!;
    transitionSprite.scale.set(1, 1);
    transitionSprite.width = params.width;
    transitionSprite.height = params.height;
    transitionSprite.alpha = 1;
    transitionSprite.blendMode = toPixiBlendMode(clip.blendMode);
    transitionSprite.filters = null;
    transitionSprite.visible = true;

    if (clip.sprite) {
      clip.sprite.visible = false;
    }
    if (prevClip?.sprite) {
      prevClip.sprite.visible = false;
    }

    if (mode !== 'background') {
      return;
    }

    const children = params.app.stage.children;
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i] as import('pixi.js').Container & { __trackId?: string };
      if (!child || child === transitionSprite) {
        continue;
      }

      const track = params.getTrackById(child?.__trackId ?? '');
      const childLayer = typeof track?.layer === 'number' ? track.layer : Number.POSITIVE_INFINITY;
      if (childLayer < clip.layer) {
        child.visible = false;
      }
    }
  }

  private async renderTransitionClipToTexture(
    clip: CompositorClip,
    texture: RenderTexture,
    params: {
      transitionOffsetTicks?: number;
      isNextClip?: boolean;
      timelineTimeTicks: number;
      stageTextureRenderer: StageTextureRenderer;
      createAbortController: (key: string) => AbortController;
      removeAbortController?: (key: string) => void;
      getVideoSampleForClip: (params: {
        clip: CompositorClip;
        sampleTimeS: number;
        timelineTimeTicks?: number;
        abortSignal?: AbortSignal;
      }) => Promise<unknown | null>;
      updateClipTextureFromSample: (sample: unknown, clip: CompositorClip) => Promise<void>;
    },
  ): Promise<boolean> {
    if (
      clip.clipKind === 'image' ||
      clip.clipKind === 'solid' ||
      clip.clipKind === 'text' ||
      clip.clipKind === 'shape' ||
      clip.clipKind === 'hud'
    ) {
      params.stageTextureRenderer.renderSingleClipToTexture(clip, texture, true);
      return true;
    }

    if (clip.clipKind === 'adjustment') {
      return false;
    }

    if (!clip.sink) {
      return false;
    }

    const speed = Math.abs(clip.speed || 1);
    const transitionOffsetTicks = Math.max(
      0,
      Math.round((params.transitionOffsetTicks ?? 0) * speed),
    );
    const sourceRangeEndTicks = clip.sourceStartTicks + clip.sourceRangeDurationTicks;
    const isReverse = (clip.speed || 1) < 0;
    // Reading toward media end (forward trailing / reverse leading handle) needs a
    // known media duration; without it we cannot prove there is material past the
    // trim and must hold the last frame — mirrors the native `source_duration_sec:
    // None => hold` branch and avoids seeking to NaN/past-EOF.
    const hasKnownDuration =
      Number.isFinite(clip.sourceDurationTicks) && clip.sourceDurationTicks > 0;
    let sampleTicks: number;

    if (params.isNextClip) {
      // Incoming (`to`) peer, composited before its own start → leading handle.
      if (isReverse) {
        // Reverse: the visible in-point sits at `sourceStart + range`; the leading
        // handle continues *forward* toward the media end. The available handle is
        // measured from the range end to EOF — not from the trim-in point.
        const handleTicks = hasKnownDuration
          ? Math.max(0, clip.sourceDurationTicks - sourceRangeEndTicks)
          : 0;
        sampleTicks =
          handleTicks < MIN_SOURCE_HANDLE_TICKS
            ? Math.max(0, sourceRangeEndTicks - MIN_SOURCE_HANDLE_TICKS)
            : Math.min(
                sourceRangeEndTicks + transitionOffsetTicks,
                clip.sourceDurationTicks - MIN_SOURCE_HANDLE_TICKS,
              );
      } else {
        // Forward: the visible in-point sits at `sourceStart`; the leading handle
        // reads *backward* toward media start. Available handle = frames before trim-in.
        const handleTicks = Math.max(0, clip.sourceStartTicks);
        sampleTicks =
          handleTicks < MIN_SOURCE_HANDLE_TICKS
            ? Math.max(0, clip.sourceStartTicks + MIN_SOURCE_HANDLE_TICKS)
            : Math.max(0, clip.sourceStartTicks - transitionOffsetTicks);
      }
    } else {
      // Outgoing (`from`) peer, composited past its own end → trailing handle.
      if (isReverse) {
        // Reverse: the visible out-point sits at `sourceStart`; the trailing handle
        // continues *backward* toward media start. Available handle = frames before it.
        const handleTicks = Math.max(0, clip.sourceStartTicks);
        sampleTicks =
          handleTicks < MIN_SOURCE_HANDLE_TICKS
            ? Math.max(0, clip.sourceStartTicks + MIN_SOURCE_HANDLE_TICKS)
            : Math.max(0, clip.sourceStartTicks - transitionOffsetTicks);
      } else {
        // Forward: the visible out-point sits at `sourceStart + range`; the trailing
        // handle reads *forward* toward the media end. Available handle = range end to EOF.
        const handleTicks = hasKnownDuration
          ? Math.max(0, clip.sourceDurationTicks - sourceRangeEndTicks)
          : 0;
        sampleTicks =
          handleTicks < MIN_SOURCE_HANDLE_TICKS
            ? Math.max(0, sourceRangeEndTicks - MIN_SOURCE_HANDLE_TICKS)
            : Math.min(
                sourceRangeEndTicks + transitionOffsetTicks,
                // Upper bound is the end of the *source*, not offset by the trim-in
                // point — adding sourceStartTicks let this request a timestamp past
                // EOF for trimmed clips.
                clip.sourceDurationTicks - MIN_SOURCE_HANDLE_TICKS,
              );
      }
    }

    const key = clip.itemId + '_transition_texture';
    const abortController = params.createAbortController(key);
    let sample: unknown | null = null;
    try {
      sample = await params.getVideoSampleForClip({
        clip,
        sampleTimeS: sampleTicks / TICKS_PER_SECOND,
        timelineTimeTicks: params.timelineTimeTicks,
        abortSignal: abortController.signal,
      });
    } finally {
      params.removeAbortController?.(key);
    }

    if (!sample) {
      if (clip.lastVideoFrame) {
        // Check if the cached frame is still usable (not closed).
        const closed = !!(clip.lastVideoFrame as { closed?: boolean }).closed;
        if (closed) {
          clip.lastVideoFrame = null;
          return false;
        }
        try {
          await params.updateClipTextureFromSample(
            { frame: clip.lastVideoFrame, close: () => {} } as unknown,
            clip,
          );
          if (clip.sprite) {
            clip.sprite.visible = true;
          }
          params.stageTextureRenderer.renderSingleClipToTexture(clip, texture);
          return true;
        } catch {
          return false;
        }
      }

      return false;
    }

    try {
      await params.updateClipTextureFromSample(sample, clip);
      if (clip.sprite) {
        clip.sprite.visible = true;
      }
      params.stageTextureRenderer.renderSingleClipToTexture(clip, texture);
      return true;
    } catch {
      return false;
    } finally {
      try {
        (sample as { close?: () => void }).close?.();
      } catch (error) {
        log.error(
          '[VideoCompositor] Failed to close VideoSample in renderClipToTextureForTransition',
          error,
        );
      }
    }
  }
}
