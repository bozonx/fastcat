import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import type { TimelineTrack, TimelineTrackItem } from '~/timeline/types';
import type { WorkerTimelineClip } from './types';
import { normalizeTimeUs } from '~/utils/monitor-time';

export function useMonitorTimeline() {
  const timelineStore = useTimelineStore();

  const videoTracks = computed(
    () =>
      (timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined)?.filter(
        (track: TimelineTrack) => track.kind === 'video',
      ) ?? [],
  );
  const audioTracks = computed(
    () =>
      (timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined)?.filter(
        (track: TimelineTrack) => track.kind === 'audio',
      ) ?? [],
  );

  const videoItems = computed(() =>
    videoTracks.value.flatMap((track) =>
      (track.items ?? []).filter((it: TimelineTrackItem) => it.kind === 'clip'),
    ),
  );

  const audioItems = computed(() =>
    audioTracks.value
      .flatMap((track) => track.items)
      .filter((it: TimelineTrackItem) => it.kind === 'clip'),
  );

  const workerTimelineClips = computed(() => {
    const docTracks = (timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined) ?? [];
    const clips: WorkerTimelineClip[] = [];
    const videoTracks = docTracks.filter((track) => track.kind === 'video');
    for (const [trackIndex, track] of videoTracks.entries()) {
      for (const item of track.items) {
        if (item.kind !== 'clip') continue;
        clips.push({
          kind: 'clip',
          id: item.id,
          layer: trackIndex,
          source: {
            path: item.source.path,
          },
          timelineRange: {
            startUs: item.timelineRange.startUs,
            durationUs: item.timelineRange.durationUs,
          },
          sourceRange: {
            startUs: item.sourceRange.startUs,
            durationUs: item.sourceRange.durationUs,
          },
        });
      }
    }
    return clips;
  });

  const workerAudioClips = computed(() => {
    const clips: WorkerTimelineClip[] = [];

    for (const item of audioItems.value) {
      if (item.kind !== 'clip') continue;
      clips.push({
        kind: 'clip',
        id: item.id,
        layer: 0,
        source: {
          path: item.source.path,
        },
        timelineRange: {
          startUs: item.timelineRange.startUs,
          durationUs: item.timelineRange.durationUs,
        },
        sourceRange: {
          startUs: item.sourceRange.startUs,
          durationUs: item.sourceRange.durationUs,
        },
      });
    }

    for (const item of videoItems.value) {
      if (item.kind !== 'clip') continue;
      if (item.audioFromVideoDisabled) continue;
      clips.push({
        kind: 'clip',
        id: `${item.id}__audio`,
        layer: 0,
        source: {
          path: item.source.path,
        },
        timelineRange: {
          startUs: item.timelineRange.startUs,
          durationUs: item.timelineRange.durationUs,
        },
        sourceRange: {
          startUs: item.sourceRange.startUs,
          durationUs: item.sourceRange.durationUs,
        },
      });
    }

    return clips;
  });

  const safeDurationUs = computed(() => normalizeTimeUs(timelineStore.duration));

  function hashString(value: string): number {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function mixHash(hash: number, value: number): number {
    hash ^= value;
    hash = Math.imul(hash, 16777619);
    return hash >>> 0;
  }

  function mixTime(hash: number, value: number): number {
    const safeValue = Number.isFinite(value) ? Math.round(value) : 0;
    const low = safeValue >>> 0;
    const high = Math.floor(safeValue / 0x1_0000_0000) >>> 0;
    return mixHash(mixHash(hash, low), high);
  }

  const clipSourceSignature = computed(() => {
    let hash = mixHash(2166136261, videoItems.value.length);
    for (const item of videoItems.value) {
      hash = mixHash(hash, hashString(item.id));
      if (item.kind === 'clip') {
        hash = mixHash(hash, hashString(item.source.path));
      }
    }
    return hash;
  });

  const clipLayoutSignature = computed(() => {
    let hash = mixHash(2166136261, videoItems.value.length);
    for (const item of videoItems.value) {
      hash = mixHash(hash, hashString(item.id));
      hash = mixTime(hash, item.timelineRange.startUs);
      hash = mixTime(hash, item.timelineRange.durationUs);
      if (item.kind === 'clip') {
        hash = mixTime(hash, item.sourceRange.startUs);
        hash = mixTime(hash, item.sourceRange.durationUs);
      }
    }
    return hash;
  });

  const audioClipLayoutSignature = computed(() => {
    const enabledVideoAudioItems = videoItems.value.filter(
      (it) => it.kind === 'clip' && !it.audioFromVideoDisabled,
    );
    let hash = mixHash(2166136261, audioItems.value.length + enabledVideoAudioItems.length);
    for (const item of audioItems.value) {
      hash = mixHash(hash, hashString(item.id));
      hash = mixTime(hash, item.timelineRange.startUs);
      hash = mixTime(hash, item.timelineRange.durationUs);
      if (item.kind === 'clip') {
        hash = mixTime(hash, item.sourceRange.startUs);
        hash = mixTime(hash, item.sourceRange.durationUs);
      }
    }
    for (const item of enabledVideoAudioItems) {
      hash = mixHash(hash, hashString(`${item.id}__audio`));
      hash = mixTime(hash, item.timelineRange.startUs);
      hash = mixTime(hash, item.timelineRange.durationUs);
      hash = mixTime(hash, item.sourceRange.startUs);
      hash = mixTime(hash, item.sourceRange.durationUs);
    }
    return hash;
  });

  const audioClipSourceSignature = computed(() => {
    const enabledVideoAudioItems = videoItems.value.filter(
      (it) => it.kind === 'clip' && !it.audioFromVideoDisabled,
    );
    let hash = mixHash(2166136261, audioItems.value.length + enabledVideoAudioItems.length);
    for (const item of audioItems.value) {
      hash = mixHash(hash, hashString(item.id));
      if (item.kind === 'clip') {
        hash = mixHash(hash, hashString(item.source.path));
      }
    }
    for (const item of enabledVideoAudioItems) {
      hash = mixHash(hash, hashString(`${item.id}__audio`));
      hash = mixHash(hash, hashString(item.source.path));
    }
    return hash;
  });

  return {
    videoTracks,
    videoItems,
    audioTracks,
    audioItems,
    workerTimelineClips,
    workerAudioClips,
    safeDurationUs,
    clipSourceSignature,
    clipLayoutSignature,
    audioClipSourceSignature,
    audioClipLayoutSignature,
  };
}
