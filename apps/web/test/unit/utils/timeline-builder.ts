import type { TimelineDocument, TimelineTrack, TimelineClipItem } from '~/timeline/types';

export class TimelineBuilder {
  private doc: TimelineDocument;

  constructor(id = 'doc-1', name = 'Default', fps = 30) {
    this.doc = {
      OTIO_SCHEMA: 'Timeline.1',
      id,
      name,
      timebase: { fps },
      tracks: [],
    } as unknown as TimelineDocument;
  }

  withTrack(id: string, kind: 'video' | 'audio' = 'video', name?: string) {
    const track: TimelineTrack = {
      id,
      kind,
      name: name ?? (kind === 'video' ? 'Video' : 'Audio'),
      items: [],
    } as unknown as TimelineTrack;

    this.doc.tracks.push(track);

    return this;
  }

  withClip(
    id: string,
    trackId: string,
    options: {
      startTicks?: number;
      durationTicks: number;
      sourceDurationTicks?: number;
      clipType?: 'media' | 'adjustment' | 'background' | 'text' | 'timeline';
      disabled?: boolean;
      audioGain?: number;
      freezeFrameSourceTicks?: number;
    },
  ) {
    const track = this.doc.tracks.find((t) => t.id === trackId);
    if (!track) throw new Error(`Track ${trackId} not found`);

    const clip: TimelineClipItem = {
      kind: 'clip',
      id,
      trackId,
      name: `Clip ${id}`,
      clipType: options.clipType ?? 'media',
      disabled: options.disabled ?? false,
      audioGain: options.audioGain ?? 1,
      freezeFrameSourceTicks: options.freezeFrameSourceTicks,
      sourceDurationTicks: (options.sourceDurationTicks ?? options.durationTicks) * 254_016,
      source: { path: '/dummy.mp4' },
      timelineRange: {
        startTicks: (options.startTicks ?? 0) * 254_016,
        durationTicks: options.durationTicks * 254_016,
      },
      sourceRange: {
        startTicks: 0,
        durationTicks: options.durationTicks * 254_016,
      },
    } as unknown as TimelineClipItem;

    track.items.push(clip);
    return this;
  }

  build(): TimelineDocument {
    return JSON.parse(JSON.stringify(this.doc)); // return deep copy
  }
}

export type TestTimelineConfig = {
  id?: string;
  name?: string;
  fps?: number;
  tracks?: Array<{
    id: string;
    kind?: 'video' | 'audio';
    name?: string;
    clips?: Array<{
      id: string;
      startTicks?: number;
      durationTicks: number;
      sourceDurationTicks?: number;
      clipType?: 'media' | 'adjustment' | 'background' | 'text' | 'timeline';
      disabled?: boolean;
      audioGain?: number;
      freezeFrameSourceTicks?: number;
      freezeFrame?: { sourceTimeTicks: number };
    }>;
  }>;
};

export function createTestTimeline(config?: TestTimelineConfig) {
  const builder = new TimelineBuilder(config?.id, config?.name, config?.fps);

  if (config?.tracks) {
    for (const trackDef of config.tracks) {
      builder.withTrack(trackDef.id, trackDef.kind, trackDef.name);
      if (trackDef.clips) {
        for (const clipDef of trackDef.clips) {
          builder.withClip(clipDef.id, trackDef.id, clipDef);
          // Manually add freezeFrame if provided since builder.withClip might not set everything
          if (clipDef.freezeFrame) {
            const track = (builder as any).doc.tracks.find((t: any) => t.id === trackDef.id);
            const clip = track.items.find((i: any) => i.id === clipDef.id);
            if (clip) {
              clip.freezeFrame = {
                sourceTimeTicks: clipDef.freezeFrame.sourceTimeTicks * 254_016,
              };
            }
          }
        }
      }
    }
    return builder.build();
  }

  return builder as any;
}
