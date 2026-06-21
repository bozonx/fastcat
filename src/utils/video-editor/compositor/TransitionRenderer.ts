import { createDevLogger } from '~/utils/dev-logger';
import { Sprite, Texture, type Application, type RenderTexture } from 'pixi.js';
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
import { getExtractedPixelBytes } from './pixelExtraction';
const log = createDevLogger('TransitionRenderer');

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
    timeUs: number,
  ) => {
    opacity: number;
    progress: number;
    mode?: string;
    manifest?: { renderMode?: string } | null;
    transition?: {
      type: string;
      mode?: string;
      durationUs?: number;
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
    abortSignal?: AbortSignal;
  }) => Promise<unknown | null>;
  updateClipTextureFromSample: (sample: unknown, clip: CompositorClip) => Promise<void>;
}

export class TransitionRenderer {
  // Reusable sprite for blitting the transition result into the clip's output
  // texture. Kept on the instance so we don't allocate a Sprite every frame of
  // every transition (the Texture still wraps a fresh ImageBitmap each frame).
  private blitSprite: Sprite | null = null;

  public destroy() {
    this.blitSprite?.destroy();
    this.blitSprite = null;
  }

  public async applyShaderTransitions(
    active: CompositorClip[],
    timeUs: number,
    params: TransitionRendererParams,
  ) {
    for (const clip of params.clips) {
      if (clip.transitionSprite) {
        clip.transitionSprite.visible = false;
        clip.transitionSprite.filters = null;
      }
    }

    for (const clip of active) {
      const state = params.getActiveTransitionState(clip, timeUs);
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
          const transitionOffsetUs = Math.max(
            0,
            state.edge === 'in' ? timeUs - clip.startUs : clip.endUs - timeUs,
          );
          const rendered = await this.renderTransitionClipToTexture(prevClip, fromTexture, {
            transitionOffsetUs,
            isNextClip: state.edge === 'out',
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
        (state.transition.durationUs ?? 0) / 1_000_000,
        {
          isPlaying: true,
          previewBlurQuality: params.previewEffectQuality,
          idleSettled: false,
        },
      );
      const curve = state.curve as import('~/transitions').TransitionCurve;
      const progress = applyTransitionCurve(state.progress, curve, normalizedParams);
      const speed = getTransitionCurveSpeed(state.progress, curve, normalizedParams);

      let fromBitmap: ImageBitmap | null = null;
      let toBitmap: ImageBitmap | null = null;
      let processed: ImageBitmap | null = null;
      try {
        fromBitmap = params.textureToBitmap
          ? await params.textureToBitmap(shaderFromTexture)
          : await this.renderTextureToBitmap(
              params.app,
              shaderFromTexture,
              params.width,
              params.height,
            );
        toBitmap = params.textureToBitmap
          ? await params.textureToBitmap(shaderToTexture)
          : await this.renderTextureToBitmap(
              params.app,
              shaderToTexture,
              params.width,
              params.height,
            );
        processed = await params.computeRunner.applyTransition({
          from: fromBitmap,
          to: toBitmap,
          spec,
          progress,
          speed,
        });
        if (!processed) continue;

        const texture = Texture.from(processed);
        if (!this.blitSprite) {
          this.blitSprite = new Sprite(texture);
        } else {
          this.blitSprite.texture = texture;
        }
        const outputSprite = this.blitSprite;
        outputSprite.width = params.width;
        outputSprite.height = params.height;
        params.app.renderer.render({
          container: outputSprite,
          target: clip.transitionOutputTexture,
          clear: true,
        });
        // The sprite is reused next frame; only the per-frame texture (backed by
        // the just-consumed ImageBitmap) is released.
        texture.destroy();
      } catch (error) {
        log.warn('[VideoCompositor] WebGPU transition failed:', error);
        continue;
      } finally {
        fromBitmap?.close();
        toBitmap?.close();
        processed?.close();
      }

      const transitionSprite = params.stageTextureRenderer.ensureTransitionSprite(clip);
      transitionSprite.texture = clip.transitionOutputTexture;
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
      if (prevClip && prevClip.sprite) {
        prevClip.sprite.visible = false;
      }

      if (mode === 'background') {
        const children = params.app.stage.children;
        for (let i = 0; i < children.length; i += 1) {
          const child = children[i] as import('pixi.js').Container & { __trackId?: string };
          if (!child || child === transitionSprite) {
            continue;
          }

          const track = params.getTrackById(child?.__trackId ?? '');
          const childLayer =
            typeof track?.layer === 'number' ? track.layer : Number.POSITIVE_INFINITY;
          if (childLayer < clip.layer) {
            child.visible = false;
          }
        }
      }
    }
  }

  private async renderTextureToBitmap(
    app: Application,
    texture: RenderTexture,
    width: number,
    height: number,
  ): Promise<ImageBitmap> {
    const pixels = app.renderer.extract.pixels(texture);
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Failed to create transition canvas context.');
    }

    const imageData = context.createImageData(width, height);
    const bytes = getExtractedPixelBytes(pixels);
    imageData.data.set(bytes);
    context.putImageData(imageData, 0, 0);
    return await createImageBitmap(canvas);
  }

  private async renderTransitionClipToTexture(
    clip: CompositorClip,
    texture: RenderTexture,
    params: {
      transitionOffsetUs?: number;
      isNextClip?: boolean;
      stageTextureRenderer: StageTextureRenderer;
      createAbortController: (key: string) => AbortController;
      removeAbortController?: (key: string) => void;
      getVideoSampleForClip: (params: {
        clip: CompositorClip;
        sampleTimeS: number;
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
    const transitionOffsetUs = Math.max(0, Math.round((params.transitionOffsetUs ?? 0) * speed));
    let sampleUs: number;

    if (params.isNextClip) {
      const handleUs = Math.max(0, clip.sourceStartUs);
      if ((clip.speed || 1) < 0) {
        sampleUs =
          handleUs < 1_000
            ? Math.max(0, clip.sourceStartUs + clip.sourceRangeDurationUs - 1_000)
            : Math.min(
                clip.sourceStartUs + clip.sourceRangeDurationUs + transitionOffsetUs,
                clip.sourceDurationUs - 1_000,
              );
      } else {
        sampleUs =
          handleUs < 1_000
            ? Math.max(0, clip.sourceStartUs + 1_000)
            : Math.max(0, clip.sourceStartUs - transitionOffsetUs);
      }
    } else {
      const handleUs = Math.max(
        0,
        clip.sourceDurationUs - clip.sourceStartUs - clip.sourceRangeDurationUs,
      );
      const sourceRangeEndUs = clip.sourceStartUs + clip.sourceRangeDurationUs;

      if ((clip.speed || 1) < 0) {
        sampleUs =
          handleUs < 1_000
            ? Math.max(0, clip.sourceStartUs + 1_000)
            : Math.max(0, clip.sourceStartUs - transitionOffsetUs);
      } else {
        sampleUs =
          handleUs < 1_000
            ? Math.max(0, clip.sourceStartUs + clip.sourceRangeDurationUs - 1_000)
            : Math.min(
                sourceRangeEndUs + transitionOffsetUs,
                // Upper bound is the end of the *source*, not offset by the trim-in
                // point — mirrors the reversed `isNextClip` branch above. Adding
                // sourceStartUs let this request a timestamp past EOF for trimmed clips.
                clip.sourceDurationUs - 1_000,
              );
      }
    }

    const key = clip.itemId + '_transition_texture';
    const abortController = params.createAbortController(key);
    let sample: unknown | null = null;
    try {
      sample = await params.getVideoSampleForClip({
        clip,
        sampleTimeS: sampleUs / 1_000_000,
        abortSignal: abortController.signal,
      });
    } finally {
      params.removeAbortController?.(key);
    }

    if (!sample) {
      if (clip.lastVideoFrame) {
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
