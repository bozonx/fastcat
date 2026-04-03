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

    if (kind === 'video') {
      const firstAudioIdx = this.doc.tracks.findIndex((t) => t.kind === 'audio');
      if (firstAudioIdx === -1) {
        this.doc.tracks.unshift(track);
      } else {
        this.doc.tracks.splice(firstAudioIdx, 0, track);
      }
    } else {
      this.doc.tracks.push(track);
    }

    return this;
  }

  withClip(
    id: string,
    trackId: string,
    options: {
      startUs?: number;
      durationUs: number;
      sourceDurationUs?: number;
      clipType?: 'media' | 'adjustment' | 'background' | 'text' | 'timeline';
      disabled?: boolean;
      audioGain?: number;
      freezeFrameSourceUs?: number;
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
      freezeFrameSourceUs: options.freezeFrameSourceUs,
      sourceDurationUs: options.sourceDurationUs ?? options.durationUs,
      source: { path: '/dummy.mp4' },
      timelineRange: {
        startUs: options.startUs ?? 0,
        durationUs: options.durationUs,
      },
      sourceRange: {
        startUs: 0,
        durationUs: options.durationUs,
      },
    } as unknown as TimelineClipItem;

    track.items.push(clip);
    return this;
  }

  build(): TimelineDocument {
    return JSON.parse(JSON.stringify(this.doc)); // return deep copy
  }
}

export function createTestTimeline() {
  return new TimelineBuilder();
}
