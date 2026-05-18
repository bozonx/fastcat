import type { CompositorClip } from './types';

export interface ActiveClipSampleRequest {
  clip: CompositorClip;
  request: Promise<{ clip: CompositorClip; sample: any | null }>;
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
  ) => Promise<{ clip: CompositorClip; sample: any | null }>;
}

export interface TimelineActiveClipProcessorResult {
  sampleRequests: Array<Promise<{ clip: CompositorClip; sample: any | null }>>;
}

const MIN_VIDEO_SAMPLE_END_GUARD_US = 1_000;

// Guard half a source frame off the end so we never request a timestamp past
// the last decodable frame. At 24 fps a frame is ~41.7 ms — a flat 1 ms guard
// would still land beyond the last sample boundary on some files.
function clampToLastReadableSourceUs(durationUs: number, frameRate?: number): number {
  const halfFrameUs =
    typeof frameRate === 'number' && Number.isFinite(frameRate) && frameRate > 0
      ? Math.round(500_000 / frameRate)
      : 0;
  const guard = Math.max(MIN_VIDEO_SAMPLE_END_GUARD_US, halfFrameUs);
  return Math.max(0, Math.round(durationUs) - guard);
}

export class TimelineActiveClipProcessor {
  public process(params: TimelineActiveClipProcessorParams): TimelineActiveClipProcessorResult {
    const { activeClips, timeUs, width, height } = params;
    const sampleRequests: Array<Promise<{ clip: CompositorClip; sample: any | null }>> = [];

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

          const speedRaw = typeof clip.speed === 'number' && clip.speed !== 0 ? clip.speed : 1;
          const speed = Math.abs(speedRaw);
          const reversed = speedRaw < 0;

          const sampleUs = reversed
            ? Math.max(
                0,
                clampToLastReadableSourceUs(state.sourceDurationUs, state.frameRate) -
                  Math.round(localTimeUs * speed),
              )
            : Math.round(localTimeUs * speed);

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
                if (typeof res.sample.toVideoFrame === 'function') {
                  if (state.lastVideoFrame) {
                    try {
                      state.lastVideoFrame.close();
                    } catch {
                      /* no-op */
                    }
                  }
                  try {
                    state.lastVideoFrame = res.sample.toVideoFrame();
                  } catch (err) {
                    // Cache may close the frame between get() and use; drop it
                    // for this round instead of failing the whole render.
                    state.lastVideoFrame = null;
                    console.warn('[TimelineActiveClipProcessor] HUD toVideoFrame failed', err);
                  }
                }
                try {
                  res.sample.close?.();
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
              return { clip, sample: { isHud: true, close: () => {} } as any };
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
      const speedRaw = typeof clip.speed === 'number' && clip.speed !== 0 ? clip.speed : 1;
      const speed = Math.abs(speedRaw);
      const reversed = speedRaw < 0;
      if (localTimeUs < 0 || localTimeUs >= clip.durationUs) {
        if (clip.sprite) clip.sprite.visible = false;
        continue;
      }

      const freezeUs = clip.freezeFrameSourceUs;
      const effectiveLocalUs = reversed
        ? Math.max(
            0,
            clampToLastReadableSourceUs(clip.sourceRangeDurationUs, clip.frameRate) -
              Math.round(localTimeUs * speed),
          )
        : Math.round(localTimeUs * speed);

      let sampleTimeS =
        typeof freezeUs === 'number'
          ? Math.max(0, freezeUs) / 1_000_000
          : Math.max(0, clip.sourceStartUs + effectiveLocalUs) / 1_000_000;

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
              if (typeof res.sample.toVideoFrame === 'function') {
                if (state.lastVideoFrame) {
                  try {
                    state.lastVideoFrame.close();
                  } catch {
                    /* no-op */
                  }
                }
                try {
                  state.lastVideoFrame = res.sample.toVideoFrame();
                } catch (err) {
                  state.lastVideoFrame = null;
                  console.warn('[TimelineActiveClipProcessor] mask toVideoFrame failed', err);
                }
              }
              try {
                res.sample.close?.();
              } catch {
                /* no-op */
              }
            }
            return { clip, sample: { isMask: true, close: () => {} } as any };
          });
        sampleRequests.push(maskPromise);
      }
    }

    return { sampleRequests };
  }
}
