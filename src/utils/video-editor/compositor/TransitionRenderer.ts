import { createDevLogger } from '~/utils/dev-logger';
import { Sprite, Texture, type Application, type RenderTexture } from 'pixi.js';
import { DEFAULT_TRANSITION_MODE } from '~/transitions';
import type { TransitionManager } from './TransitionManager';
import { toPixiBlendMode, type CompositorClip, type CompositorTrack } from './types';
import type { StageTextureRenderer } from './StageTextureRenderer';
const log = createDevLogger('TransitionRenderer');

export interface TransitionRendererParams {
  app: Application;
  clips: CompositorClip[];
  width: number;
  height: number;
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
    transition?: { mode?: string; durationUs?: number; params?: Record<string, unknown> };
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
  private filterQuadSprite: Sprite | null = null;

  public destroy() {
    if (this.filterQuadSprite) {
      this.filterQuadSprite.destroy();
      this.filterQuadSprite = null;
    }
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
      if (!state || state.manifest?.renderMode !== 'shader' || !clip.transitionFilter) {
        continue;
      }

      const transitionFilter = params.transitionManager.ensureUsableTransitionFilter(
        clip,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        state.manifest as any,
      );
      if (!transitionFilter) {
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

      const transitionContext = {
        progress: state.progress,
        curve: state.curve,
        elapsedUs:
          state.edge === 'in'
            ? timeUs - clip.startUs
            : timeUs - (clip.endUs - (state.transition?.durationUs ?? 0)),
        durationUs: state.transition?.durationUs ?? 0,
        edge: state.edge as 'in' | 'out',
        params: state.transition?.params ?? {},
        fromTexture: shaderFromTexture,
        toTexture: shaderToTexture,
      };

      const filterUpdated = params.transitionManager.updateTransitionFilterSafely(
        clip,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        state.manifest as any,
        transitionFilter,
        transitionContext,
      );
      if (!filterUpdated) {
        continue;
      }

      const filterQuadSprite = this.ensureFilterQuadSprite();
      filterQuadSprite.texture = shaderToTexture;
      filterQuadSprite.scale.set(1, 1);
      filterQuadSprite.width = params.width;
      filterQuadSprite.height = params.height;
      filterQuadSprite.filters = [filterUpdated];

      params.app.renderer.render({
        container: filterQuadSprite,
        target: clip.transitionOutputTexture,
        clear: true,
      });

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

  private ensureFilterQuadSprite(): Sprite {
    if (!this.filterQuadSprite) {
      this.filterQuadSprite = new Sprite(Texture.EMPTY);
      this.filterQuadSprite.x = 0;
      this.filterQuadSprite.y = 0;
      this.filterQuadSprite.anchor.set(0, 0);
    }

    return this.filterQuadSprite;
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
                clip.sourceStartUs + clip.sourceDurationUs - 1_000,
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
