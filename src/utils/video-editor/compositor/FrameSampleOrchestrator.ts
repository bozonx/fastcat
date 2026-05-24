import {
  DEFAULT_TRANSITION_CURVE,
  DEFAULT_TRANSITION_MODE,
  getTransitionManifest,
  normalizeTransitionParams,
} from '~/transitions';
import type { CompositorClip } from './types';
import {
  clampToLastReadableSourceUs,
  type TimelineActiveClipProcessor,
} from './TimelineActiveClipProcessor';

export interface FrameSampleOrchestratorParams {
  activeClips: CompositorClip[];
  timeUs: number;
  width: number;
  height: number;
  activeClipProcessor: TimelineActiveClipProcessor;
  syncTransitionFilter: (clip: CompositorClip, timeUs: number) => void;
  computeTransitionOpacity: (clip: CompositorClip, timeUs: number) => number;
  applyClipEffects: (clip: CompositorClip) => void;
  drawHudClip: (clip: CompositorClip, timeUs: number) => void;
  drawShapeClip: (clip: CompositorClip, size: { width: number; height: number }) => void;
  drawTextClip: (clip: CompositorClip, size: { width: number; height: number }) => void;
  createAbortController: (key: string) => AbortController;
  removeAbortController?: (key: string) => void;
  getVideoSampleForClip: (params: {
    clip: CompositorClip;
    sampleTimeS: number;
    abortSignal?: AbortSignal;
  }) => Promise<unknown | null>;
  getPrevClipOnLayer: (clip: CompositorClip) => CompositorClip | null;
  updateClipTextureFromSample: (sample: unknown, clip: CompositorClip) => Promise<void>;
  setClipSpriteVisible: (clip: CompositorClip, visible: boolean) => boolean;
}

export interface FrameSampleOrchestratorResult {
  updatedClips: CompositorClip[];
}

export class FrameSampleOrchestrator {
  public async process(
    params: FrameSampleOrchestratorParams,
  ): Promise<FrameSampleOrchestratorResult> {
    const { sampleRequests } = params.activeClipProcessor.process({
      activeClips: params.activeClips,
      timeUs: params.timeUs,
      width: params.width,
      height: params.height,
      syncTransitionFilter: params.syncTransitionFilter,
      computeTransitionOpacity: params.computeTransitionOpacity,
      drawHudClip: params.drawHudClip,
      drawShapeClip: params.drawShapeClip,
      drawTextClip: params.drawTextClip,
      createPrimaryVideoSampleRequest: (clip, sampleTimeS) => {
        const key = clip.itemId + '_primary';
        const abortController = params.createAbortController(key);

        return params
          .getVideoSampleForClip({
            clip,
            sampleTimeS,
            abortSignal: abortController.signal,
          })
          .then((sample) => {
            params.removeAbortController?.(key);
            return { clip, sample };
          })
          .catch((error) => {
            params.removeAbortController?.(key);
            console.error('[VideoCompositor] Failed to render sample', error);
            return { clip, sample: null };
          });
      },
    });

    const blendShadowRequests = this.buildBlendShadowRequests(params);
    const updatedClips: CompositorClip[] = [];

    if (blendShadowRequests.length > 0) {
      const shadowSamples = await Promise.all(blendShadowRequests);
      await this.applySampleResults({
        samples: shadowSamples,
        updatedClips,
        updateClipTextureFromSample: params.updateClipTextureFromSample,
        setClipSpriteVisible: params.setClipSpriteVisible,
        onError: (error) => {
          console.warn('[VideoCompositor] Failed to update shadow clip texture:', error);
        },
      });
    }

    this.hideCompositePrevClips(params.activeClips, params.timeUs, params.getPrevClipOnLayer);

    if (sampleRequests.length > 0) {
      const samples = await Promise.all(sampleRequests);
      await this.applySampleResults({
        samples,
        updatedClips,
        updateClipTextureFromSample: params.updateClipTextureFromSample,
        setClipSpriteVisible: params.setClipSpriteVisible,
        onError: (error) => {
          console.error('[VideoCompositor] Failed to update clip texture', error);
        },
      });
    }

    // Effects (including clip mask) must run after video textures and mask frames are updated.
    // TimelineActiveClipProcessor previously ran applyClipEffects before samples, so video masks
    // had no maskState.lastVideoFrame yet and the mask filter never applied correctly.
    for (const clip of params.activeClips) {
      params.applyClipEffects(clip);
    }

    return { updatedClips };
  }

  private buildBlendShadowRequests(
    params: FrameSampleOrchestratorParams,
  ): Array<Promise<{ clip: CompositorClip; sample: unknown | null }>> {
    const requests: Array<Promise<{ clip: CompositorClip; sample: unknown | null }>> = [];

    for (const clip of params.activeClips) {
      const transition = clip.transitionIn;
      const mode = transition?.mode ?? DEFAULT_TRANSITION_MODE;
      if (!transition || mode !== 'adjacent' || transition.durationUs <= 0) {
        continue;
      }

      const localTimeUs = params.timeUs - clip.startUs;
      if (localTimeUs >= transition.durationUs) {
        continue;
      }

      const prevClip = params.getPrevClipOnLayer(clip);
      if (!prevClip || params.activeClips.includes(prevClip)) {
        continue;
      }

      const manifest = getTransitionManifest(transition.type);
      const rawProgress = Math.max(0, Math.min(1, localTimeUs / transition.durationUs));
      const shadowAlpha = manifest
        ? manifest.computeOutOpacity(
            rawProgress,
            (normalizeTransitionParams(transition.type, transition.params) as Record<
              string,
              unknown
            >) ?? {},
            transition.curve ?? DEFAULT_TRANSITION_CURVE,
          )
        : 1 - rawProgress;

      if (prevClip.sprite) {
        prevClip.sprite.alpha = Math.max(0, Math.min(1, shadowAlpha));
      }

      if (
        prevClip.clipKind === 'image' ||
        prevClip.clipKind === 'solid' ||
        prevClip.clipKind === 'shape' ||
        prevClip.clipKind === 'text' ||
        prevClip.clipKind === 'hud'
      ) {
        if (prevClip.sprite) prevClip.sprite.visible = true;
        continue;
      }

      if (!prevClip.sink) {
        if (prevClip.sprite) prevClip.sprite.visible = false;
        continue;
      }

      // Timeline-space localTimeUs maps to source-space via |speed|; sampling
      // without it freezes/overshoots the shadow frame whenever the previous
      // clip is not at unity speed.
      const speedRaw = Number(prevClip.speed);
      const sourceSpeed = Number.isFinite(speedRaw) && speedRaw !== 0 ? Math.abs(speedRaw) : 1;
      const reversed = Number.isFinite(speedRaw) && speedRaw < 0;
      const sourceDeltaUs = Math.max(0, Math.round(localTimeUs * sourceSpeed));

      // Handle = unread source material on the side we're about to extend into.
      // Forward playback consumes the trailing handle; reversed consumes leading.
      const trailingHandleUs = Math.max(
        0,
        prevClip.sourceDurationUs - prevClip.sourceStartUs - prevClip.sourceRangeDurationUs,
      );
      const leadingHandleUs = Math.max(0, prevClip.sourceStartUs);
      const handleUs = reversed ? leadingHandleUs : trailingHandleUs;

      const lastReadableSourceUs = clampToLastReadableSourceUs(
        prevClip.sourceDurationUs,
        prevClip.frameRate,
      );

      if (handleUs < 1_000) {
        const sourceRangeEndUs = prevClip.sourceStartUs + prevClip.sourceRangeDurationUs;
        const lastUs = reversed
          ? Math.max(0, Math.min(sourceRangeEndUs, prevClip.sourceStartUs + 1_000))
          : Math.max(0, Math.min(lastReadableSourceUs, sourceRangeEndUs - 1_000));
        requests.push(
          this.createSampleRequest({
            clip: prevClip,
            key: prevClip.itemId + '_shadow_end',
            sampleTimeS: lastUs / 1_000_000,
            createAbortController: params.createAbortController,
            removeAbortController: params.removeAbortController,
            getVideoSampleForClip: params.getVideoSampleForClip,
          }),
        );
        continue;
      }

      const sourceRangeEndUs = prevClip.sourceStartUs + prevClip.sourceRangeDurationUs;
      const sampleUs = reversed
        ? Math.max(0, prevClip.sourceStartUs - sourceDeltaUs)
        : Math.min(sourceRangeEndUs + sourceDeltaUs, lastReadableSourceUs);

      requests.push(
        this.createSampleRequest({
          clip: prevClip,
          key: prevClip.itemId + '_shadow_overrun',
          sampleTimeS: Math.max(0, sampleUs / 1_000_000),
          createAbortController: params.createAbortController,
          removeAbortController: params.removeAbortController,
          getVideoSampleForClip: params.getVideoSampleForClip,
        }),
      );
    }

    return requests;
  }

  private createSampleRequest(params: {
    clip: CompositorClip;
    key: string;
    sampleTimeS: number;
    createAbortController: (key: string) => AbortController;
    removeAbortController?: (key: string) => void;
    getVideoSampleForClip: (params: {
      clip: CompositorClip;
      sampleTimeS: number;
      abortSignal?: AbortSignal;
    }) => Promise<unknown | null>;
  }): Promise<{ clip: CompositorClip; sample: unknown | null }> {
    const abortController = params.createAbortController(params.key);

    return params
      .getVideoSampleForClip({
        clip: params.clip,
        sampleTimeS: params.sampleTimeS,
        abortSignal: abortController.signal,
      })
      .then((sample) => {
        params.removeAbortController?.(params.key);
        return { clip: params.clip, sample };
      })
      .catch((error) => {
        params.removeAbortController?.(params.key);
        console.warn('[VideoCompositor] Failed to get shadow sample:', error);
        return { clip: params.clip, sample: null };
      });
  }

  private async applySampleResults(params: {
    samples: Array<{ clip: CompositorClip; sample: unknown | null }>;
    updatedClips: CompositorClip[];
    updateClipTextureFromSample: (sample: unknown, clip: CompositorClip) => Promise<void>;
    setClipSpriteVisible: (clip: CompositorClip, visible: boolean) => boolean;
    onError: (error: unknown) => void;
  }) {
    for (const { clip, sample } of params.samples) {
      if (!sample) {
        params.setClipSpriteVisible(clip, false);
        continue;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sampleAny = sample as any;
      try {
        if (sampleAny.isHud || sampleAny.isMask) {
          // HUD and Mask frames are handled during sample request processing
          // or in drawHudClip, so we don't update main texture here.
        } else {
          await params.updateClipTextureFromSample(sample, clip);
        }
        const becameVisible = params.setClipSpriteVisible(clip, true);
        // Mask samples ride alongside the clip's primary sample; the primary
        // push already takes care of disposal. Skipping the duplicate keeps
        // updatedClips clean for downstream consumers.
        if (becameVisible && !sampleAny.isMask) {
          params.updatedClips.push(clip);
        }
      } catch (error) {
        params.onError(error);
        params.setClipSpriteVisible(clip, false);
      } finally {
        if (typeof sampleAny.close === 'function') {
          try {
            sampleAny.close();
          } catch (error) {
            params.onError(error);
          }
        }
      }
    }
  }

  private hideCompositePrevClips(
    activeClips: CompositorClip[],
    timeUs: number,
    getPrevClipOnLayer: (clip: CompositorClip) => CompositorClip | null,
  ) {
    for (const clip of activeClips) {
      const transition = clip.transitionIn;
      const mode = transition?.mode ?? DEFAULT_TRANSITION_MODE;
      if (
        !transition ||
        (mode !== 'background' && mode !== 'transparent') ||
        transition.durationUs <= 0
      ) {
        continue;
      }

      const localTimeUs = timeUs - clip.startUs;
      if (localTimeUs >= transition.durationUs) {
        continue;
      }

      const prevClip = getPrevClipOnLayer(clip);
      if (prevClip && !activeClips.includes(prevClip)) {
        if (prevClip.sprite) prevClip.sprite.visible = false;
      }
    }
  }
}
