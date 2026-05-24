import type { CompositorClip } from './types';
import {
  clampToLastReadableSourceUs,
  MIN_SOURCE_TIME_END_GUARD_US,
  normalizeClipSpeed,
  resolveClipSourceTimeUs,
} from '../source-time';

export interface ActiveClipSampleRequest {
  clip: CompositorClip;
  request: Promise<{ clip: CompositorClip; sample: unknown | null }>;
}

export interface TimelineActiveClipProcessorParams {
  activeClips: CompositorClip[];
  timeUs: number;
  width: number;
  height: number;
  syncTransitionFilter: (clip: CompositorClip, timeUs: number) => void;
  computeTransitionOpacity: (clip: CompositorClip, timeUs: number) => number;
  drawHudClip: (clip: CompositorClip, timeUs: number) => void;
  drawShapeClip: (clip: CompositorClip, size: { width: number; height: number }) => void;
  drawTextClip: (clip: CompositorClip, size: { width: number; height: number }) => void;
  createPrimaryVideoSampleRequest: (
    clip: CompositorClip,
    sampleTimeS: number,
  ) => Promise<{ clip: CompositorClip; sample: unknown | null }>;
}

export interface TimelineActiveClipProcessorResult {
  sampleRequests: Array<Promise<{ clip: CompositorClip; sample: unknown | null }>>;
}

export const MIN_VIDEO_SAMPLE_END_GUARD_US = MIN_SOURCE_TIME_END_GUARD_US;

// Guard half a source frame off the end so we never request a timestamp past
// the last decodable frame. At 24 fps a frame is ~41.7 ms — a flat 1 ms guard
// would still land beyond the last sample boundary on some files.
export { clampToLastReadableSourceUs };

export class TimelineActiveClipProcessor {
  public process(params: TimelineActiveClipProcessorParams): TimelineActiveClipProcessorResult {
    const { activeClips, timeUs, width, height } = params;
    const sampleRequests: Array<Promise<{ clip: CompositorClip; sample: unknown | null }>> = [];

    for (const clip of activeClips) {
      params.syncTransitionFilter(clip, timeUs);
      const effectiveOpacity = params.computeTransitionOpacity(clip, timeUs);
      if (clip.sprite) {
        clip.sprite.alpha = effectiveOpacity;
        clip.sprite.blendMode = clip.blendMode ?? 'normal';
      }

      if (
        clip.clipKind === 'image' ||
        clip.clipKind === 'solid' ||
        clip.clipKind === 'adjustment'
      ) {
        if (clip.sprite) clip.sprite.visible = true;
        continue;
      }

      if (clip.clipKind === 'hud') {
        const dirty = !!clip.hudDirty;
        const statePromises: Promise<void>[] = [];

        const handleState = (
          state: import('./types').HudMediaState | undefined,
          suffix: string,
        ) => {
          if (!state || state.clipKind !== 'video' || !state.sink) return;

          const localTimeUs = timeUs - clip.startUs;
          if (localTimeUs < 0 || localTimeUs >= clip.durationUs) return;

          const sampleUs = resolveClipSourceTimeUs({
            localTimeUs,
            sourceStartUs: 0,
            sourceRangeDurationUs: state.sourceDurationUs,
            speed: clip.speed,
            frameRate: state.frameRate,
          });

          let sampleTimeS = sampleUs / 1_000_000;
          if (!Number.isFinite(sampleTimeS) || Number.isNaN(sampleTimeS)) sampleTimeS = 0;

          const mockClip = {
            itemId: clip.itemId + suffix,
            sink: state.sink,
            firstTimestampS: state.firstTimestampS,
            frameRate: state.frameRate,
          } as CompositorClip;

          statePromises.push(
            params.createPrimaryVideoSampleRequest(mockClip, sampleTimeS).then((res) => {
              if (res.sample) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const sampleAny = res.sample as any;
                if (typeof sampleAny.toVideoFrame === 'function') {
                  if (state.lastVideoFrame) {
                    try {
                      state.lastVideoFrame.close();
                    } catch {
                      /* no-op */
                    }
                  }
                  try {
                    state.lastVideoFrame = sampleAny.toVideoFrame();
                  } catch (err) {
                    // Cache may close the frame between get() and use; drop it
                    // for this round instead of failing the whole render.
                    state.lastVideoFrame = null;
                    console.warn('[TimelineActiveClipProcessor] HUD toVideoFrame failed', err);
                  }
                }
                try {
                  sampleAny.close?.();
                } catch {
                  /* no-op */
                }
              }
            }),
          );
        };

        handleState(clip.hudMediaStates?.background, '_bg');
        handleState(clip.hudMediaStates?.content, '_ct');
        handleState(clip.hudMediaStates?.frame, '_fr');

        if (statePromises.length > 0) {
          sampleRequests.push(
            Promise.all(statePromises).then(() => {
              params.drawHudClip(clip, timeUs);
              // Return a special object that tells applySampleResults not to hide the clip
              return { clip, sample: { isHud: true, close: () => {} } as unknown };
            }),
          );
        } else if (dirty) {
          params.drawHudClip(clip, timeUs);
        }

        clip.hudDirty = false;
        if (clip.sprite) clip.sprite.visible = true;
        continue;
      }

      if (clip.clipKind === 'shape') {
        if (clip.shapeDirty) {
          params.drawShapeClip(clip, { width, height });
          clip.shapeDirty = false;
        }
        if (clip.sprite) clip.sprite.visible = true;
        continue;
      }

      if (clip.clipKind === 'text') {
        if (clip.textDirty) {
          params.drawTextClip(clip, { width, height });
          clip.textDirty = false;
        }
        if (clip.sprite) clip.sprite.visible = true;
        continue;
      }

      const localTimeUs = timeUs - clip.startUs;
      const speed = normalizeClipSpeed(clip.speed);
      if (localTimeUs < 0 || localTimeUs >= clip.durationUs) {
        if (clip.sprite) clip.sprite.visible = false;
        continue;
      }

      const freezeUs = clip.freezeFrameSourceUs;
      let sampleTimeS =
        typeof freezeUs === 'number'
          ? Math.max(0, freezeUs) / 1_000_000
          : resolveClipSourceTimeUs({
              localTimeUs,
              sourceStartUs: clip.sourceStartUs,
              sourceRangeDurationUs: clip.sourceRangeDurationUs,
              speed,
              frameRate: clip.frameRate,
            }) / 1_000_000;

      if (!Number.isFinite(sampleTimeS) || Number.isNaN(sampleTimeS)) {
        sampleTimeS = 0;
      }

      if (!clip.sink) {
        if (clip.sprite) clip.sprite.visible = false;
        continue;
      }

      sampleRequests.push(params.createPrimaryVideoSampleRequest(clip, sampleTimeS));

      if (clip.maskState?.clipKind === 'video' && clip.maskState.sink) {
        const mockClip = {
          itemId: clip.itemId + '_mask',
          sink: clip.maskState.sink,
          firstTimestampS: clip.maskState.firstTimestampS,
          frameRate: clip.maskState.frameRate,
        } as CompositorClip;

        const maskPromise = params
          .createPrimaryVideoSampleRequest(mockClip, sampleTimeS)
          .then((res) => {
            if (res.sample) {
              const state = clip.maskState!;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const sampleAny = res.sample as any;
              if (typeof sampleAny.toVideoFrame === 'function') {
                if (state.lastVideoFrame) {
                  try {
                    state.lastVideoFrame.close();
                  } catch {
                    /* no-op */
                  }
                }
                try {
                  state.lastVideoFrame = sampleAny.toVideoFrame();
                } catch (err) {
                  state.lastVideoFrame = null;
                  console.warn('[TimelineActiveClipProcessor] mask toVideoFrame failed', err);
                }
              }
              try {
                sampleAny.close?.();
              } catch {
                /* no-op */
              }
            }
            return { clip, sample: { isMask: true, close: () => {} } as unknown };
          });
        sampleRequests.push(maskPromise);
      }
    }

    return { sampleRequests };
  }
}
