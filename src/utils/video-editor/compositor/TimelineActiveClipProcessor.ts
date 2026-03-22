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
  applyClipEffects: (clip: CompositorClip) => void;
  drawHudClip: (clip: CompositorClip) => void;
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

      params.applyClipEffects(clip);

      if (
        clip.clipKind === 'image' ||
        clip.clipKind === 'solid' ||
        clip.clipKind === 'adjustment'
      ) {
        if (clip.sprite) clip.sprite.visible = true;
        continue;
      }

      if (clip.clipKind === 'hud') {
        let dirty = !!clip.hudDirty;
        let hudHasVideo = false;

        const handleState = (state: import('./types').HudMediaState | undefined, suffix: string) => {
          if (!state || state.clipKind !== 'video' || !state.sink) return;
          dirty = true;
          hudHasVideo = true;
          const localTimeUs = timeUs - clip.startUs;
          if (localTimeUs < 0 || localTimeUs >= clip.durationUs) return;
          
          const speedRaw = typeof clip.speed === 'number' && clip.speed !== 0 ? clip.speed : 1;
          const speed = Math.abs(speedRaw);
          const reversed = speedRaw < 0;
          
          let sampleUs = reversed
            ? Math.max(0, state.sourceDurationUs - Math.round(localTimeUs * speed))
            : Math.round(localTimeUs * speed);
            
          let sampleTimeS = sampleUs / 1_000_000;
          if (!Number.isFinite(sampleTimeS) || Number.isNaN(sampleTimeS)) sampleTimeS = 0;
          
          const mockClip = { itemId: clip.itemId + suffix, sink: state.sink, firstTimestampS: state.firstTimestampS } as CompositorClip;
          
          sampleRequests.push(params.createPrimaryVideoSampleRequest(mockClip, sampleTimeS).then(res => {
            if (res.sample) {
              if (typeof res.sample.toVideoFrame === 'function') {
                if (state.lastVideoFrame) {
                  try { state.lastVideoFrame.close(); } catch {}
                }
                state.lastVideoFrame = res.sample.toVideoFrame();
              }
              try { res.sample.close?.(); } catch {}
            }
            params.drawHudClip(clip);
            return { clip, sample: null };
          }));
        };

        handleState(clip.hudMediaStates?.background, '_bg');
        handleState(clip.hudMediaStates?.content, '_ct');

        if (dirty && !hudHasVideo) {
           params.drawHudClip(clip);
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
        ? Math.max(0, clip.sourceRangeDurationUs - Math.round(localTimeUs * speed))
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
    }

    return { sampleRequests };
  }
}
