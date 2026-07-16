import { createDevLogger } from '~/utils/dev-logger';
import { TICKS_PER_MICROSECOND, TICKS_PER_SECOND } from '~/utils/time';
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
const log = createDevLogger('FrameSampleOrchestrator');

/** Minimum usable handle in canonical timeline ticks (~1 ms). */
const MIN_SOURCE_HANDLE_US = 1_000 * TICKS_PER_MICROSECOND;

export interface FrameSampleOrchestratorParams {
  activeClips: CompositorClip[];
  timeUs: number;
  monitorSyncMode?: 'smooth' | 'balanced' | 'strict';
  width: number;
  height: number;
  activeClipProcessor: TimelineActiveClipProcessor;
  /**
   * Recompute keyframe overlays for the active clips and re-apply layout for the
   * kinds that don't re-layout per sample. Runs before any per-clip processing so
   * opacity/transform reads see this frame's animated values.
   */
  resolveClipOverlays?: (activeClips: CompositorClip[], timeUs: number) => void;
  syncTransitionFilter: (clip: CompositorClip, timeUs: number) => void;
  computeTransitionOpacity: (clip: CompositorClip, timeUs: number) => number;
  applyClipEffects: (clip: CompositorClip) => void;
  applyWebGpuClipEffects?: (clip: CompositorClip) => Promise<void>;
  drawHudClip: (clip: CompositorClip, timeUs: number) => void;
  drawShapeClip: (clip: CompositorClip, size: { width: number; height: number }) => void;
  drawTextClip: (clip: CompositorClip, size: { width: number; height: number }) => void;
  createAbortController: (key: string) => AbortController;
  removeAbortController?: (key: string) => void;
  getVideoSampleForClip: (params: {
    clip: CompositorClip;
    sampleTimeS: number;
    timelineTimeUs?: number;
    monitorSyncMode?: 'smooth' | 'balanced' | 'strict';
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
    params.resolveClipOverlays?.(params.activeClips, params.timeUs);

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
            timelineTimeUs: params.timeUs,
            monitorSyncMode: params.monitorSyncMode,
            abortSignal: abortController.signal,
          })
          .then((sample) => {
            params.removeAbortController?.(key);
            return { clip, sample };
          })
          .catch((error) => {
            params.removeAbortController?.(key);
            log.error('[VideoCompositor] Failed to render sample', error);
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
          log.warn('[VideoCompositor] Failed to update shadow clip texture:', error);
        },
      });
    }

    this.hideCompositePrevClips(params.activeClips, params.timeUs, params.getPrevClipOnLayer);

    if (sampleRequests.length > 0) {
      const settled = await Promise.allSettled(sampleRequests);
      const samples = settled
        .filter(
          (r): r is PromiseFulfilledResult<{ clip: CompositorClip; sample: unknown | null }> =>
            r.status === 'fulfilled',
        )
        .map((r) => r.value);
      await this.applySampleResults({
        samples,
        updatedClips,
        updateClipTextureFromSample: params.updateClipTextureFromSample,
        setClipSpriteVisible: params.setClipSpriteVisible,
        onError: (error) => {
          log.error('[VideoCompositor] Failed to update clip texture', error);
        },
      });
    }

    // Effects (including clip mask) must run after video textures and mask frames are updated.
    // TimelineActiveClipProcessor previously ran applyClipEffects before samples, so video masks
    // had no maskState.lastVideoFrame yet and the mask filter never applied correctly.
    for (const clip of params.activeClips) {
      params.applyClipEffects(clip);
    }

    // WebGPU compute effects for non-video clips (image, text, shape, solid).
    if (params.applyWebGpuClipEffects) {
      for (const clip of params.activeClips) {
        if (
          clip.clipKind === 'image' ||
          clip.clipKind === 'text' ||
          clip.clipKind === 'shape' ||
          clip.clipKind === 'solid'
        ) {
          await params.applyWebGpuClipEffects(clip);
        }
      }
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

      if (handleUs < MIN_SOURCE_HANDLE_US) {
        const sourceRangeEndUs = prevClip.sourceStartUs + prevClip.sourceRangeDurationUs;
        const lastUs = reversed
          ? Math.max(0, Math.min(sourceRangeEndUs, prevClip.sourceStartUs + MIN_SOURCE_HANDLE_US))
          : Math.max(0, Math.min(lastReadableSourceUs, sourceRangeEndUs - MIN_SOURCE_HANDLE_US));
        requests.push(
          this.createSampleRequest({
            clip: prevClip,
            key: prevClip.itemId + '_shadow_end',
            sampleTimeS: lastUs / TICKS_PER_SECOND,
            timelineTimeUs: params.timeUs,
            monitorSyncMode: params.monitorSyncMode,
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
          sampleTimeS: Math.max(0, sampleUs / TICKS_PER_SECOND),
          timelineTimeUs: params.timeUs,
          monitorSyncMode: params.monitorSyncMode,
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
    timelineTimeUs: number;
    monitorSyncMode?: 'smooth' | 'balanced' | 'strict';
    createAbortController: (key: string) => AbortController;
    removeAbortController?: (key: string) => void;
    getVideoSampleForClip: (params: {
      clip: CompositorClip;
      sampleTimeS: number;
      timelineTimeUs?: number;
      monitorSyncMode?: 'smooth' | 'balanced' | 'strict';
      abortSignal?: AbortSignal;
    }) => Promise<unknown | null>;
  }): Promise<{ clip: CompositorClip; sample: unknown | null }> {
    const abortController = params.createAbortController(params.key);

    return params
      .getVideoSampleForClip({
        clip: params.clip,
        sampleTimeS: params.sampleTimeS,
        timelineTimeUs: params.timelineTimeUs,
        monitorSyncMode: params.monitorSyncMode,
        abortSignal: abortController.signal,
      })
      .then((sample) => {
        params.removeAbortController?.(params.key);
        return { clip: params.clip, sample };
      })
      .catch((error) => {
        params.removeAbortController?.(params.key);
        log.warn('[VideoCompositor] Failed to get shadow sample:', error);
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
