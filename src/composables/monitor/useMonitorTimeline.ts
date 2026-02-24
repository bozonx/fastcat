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
    videoTracks.value
      .filter((track) => !track.videoHidden)
      .flatMap((track) =>
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
    const videoTracks = docTracks.filter((track) => track.kind === 'video' && !track.videoHidden);
    const trackCount = videoTracks.length;
    for (const [trackIndex, track] of videoTracks.entries()) {
      for (const item of track.items) {
        if (item.kind !== 'clip') continue;

        const clipEffects = item.effects ? JSON.parse(JSON.stringify(item.effects)) : undefined;
        const trackEffects = track.effects ? JSON.parse(JSON.stringify(track.effects)) : undefined;
        const effects =
          clipEffects && trackEffects
            ? [...clipEffects, ...trackEffects]
            : (clipEffects ?? trackEffects);

        const base: WorkerTimelineClip = {
          kind: 'clip',
          clipType: item.clipType,
          id: item.id,
          layer: trackCount - 1 - trackIndex,
          opacity: item.opacity,
          effects,
          timelineRange: {
            startUs: item.timelineRange.startUs,
            durationUs: item.timelineRange.durationUs,
          },
          sourceRange: {
            startUs: item.sourceRange.startUs,
            durationUs: item.sourceRange.durationUs,
          },
        };

        if (item.clipType === 'media') {
          clips.push({
            ...base,
            source: { path: item.source.path },
          });
        } else if (item.clipType === 'background') {
          clips.push({
            ...base,
            backgroundColor: item.backgroundColor,
          });
        } else {
          clips.push(base);
        }
      }
    }
    return clips;
  });

  const workerAudioClips = computed(() => {
    const clips: WorkerTimelineClip[] = [];

    const allAudioTracks = audioTracks.value;
    const allVideoTracks = videoTracks.value;

    const hasSolo = [...allAudioTracks, ...allVideoTracks].some((t) => Boolean(t.audioSolo));

    const effectiveAudioTracks = hasSolo
      ? allAudioTracks.filter((t) => Boolean(t.audioSolo))
      : allAudioTracks.filter((t) => !t.audioMuted);

    const effectiveVideoTracksForAudio = hasSolo
      ? allVideoTracks.filter((t) => Boolean(t.audioSolo))
      : allVideoTracks.filter((t) => !t.audioMuted);

    for (const item of effectiveAudioTracks.flatMap((t) => t.items)) {
      if (item.kind !== 'clip') continue;
      if (item.clipType !== 'media') continue;
      if (!item.source) continue;
      clips.push({
        kind: 'clip',
        clipType: 'media',
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

    const videoTrackIdsForAudio = new Set(effectiveVideoTracksForAudio.map((t) => t.id));
    for (const track of allVideoTracks) {
      if (!videoTrackIdsForAudio.has(track.id)) continue;
      for (const item of track.items) {
        if (item.kind !== 'clip') continue;
        if (item.clipType !== 'media') continue;
        if (item.audioFromVideoDisabled) continue;
        if (!item.source) continue;
        clips.push({
          kind: 'clip',
          clipType: 'media',
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

  function mixFloat(hash: number, value: unknown, scale = 1000): number {
    const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
    return mixTime(hash, Math.round(n * scale));
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
    const docTracks = (timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined) ?? [];
    const videoTracks = docTracks.filter((t) => t.kind === 'video' && !t.videoHidden);
    const trackById = new Map<string, TimelineTrack>(videoTracks.map((t) => [t.id, t]));

    for (const item of videoItems.value) {
      hash = mixHash(hash, hashString(item.id));
      hash = mixTime(hash, item.timelineRange.startUs);
      hash = mixTime(hash, item.timelineRange.durationUs);
      if (item.kind === 'clip') {
        hash = mixTime(hash, item.sourceRange.startUs);
        hash = mixTime(hash, item.sourceRange.durationUs);

        hash = mixFloat(hash, item.opacity ?? 1, 1000);

        const clipEffects = Array.isArray((item as any).effects) ? (item as any).effects : null;
        if (clipEffects) {
          hash = mixHash(hash, hashString(JSON.stringify(clipEffects)));
        }

        const track = trackById.get((item as any).trackId);
        if (Array.isArray((track as any)?.effects)) {
          hash = mixHash(hash, hashString(JSON.stringify((track as any).effects)));
        }
      }
    }
    return hash;
  });

  const audioClipLayoutSignature = computed(() => {
    const allAudioTracks = audioTracks.value;
    const allVideoTracks = videoTracks.value;

    const hasSolo = [...allAudioTracks, ...allVideoTracks].some((t) => Boolean(t.audioSolo));

    const effectiveAudioTracks = hasSolo
      ? allAudioTracks.filter((t) => Boolean(t.audioSolo))
      : allAudioTracks.filter((t) => !t.audioMuted);

    const effectiveVideoTracksForAudio = hasSolo
      ? allVideoTracks.filter((t) => Boolean(t.audioSolo))
      : allVideoTracks.filter((t) => !t.audioMuted);

    const effectiveAudioItems = effectiveAudioTracks
      .flatMap((t) => t.items)
      .filter((it: TimelineTrackItem) => it.kind === 'clip');

    const enabledVideoAudioItems = effectiveVideoTracksForAudio
      .flatMap((t) => t.items)
      .filter(
        (it: TimelineTrackItem): it is Extract<TimelineTrackItem, { kind: 'clip' }> =>
          it.kind === 'clip' && !it.audioFromVideoDisabled,
      );

    let hash = mixHash(2166136261, effectiveAudioItems.length + enabledVideoAudioItems.length);
    hash = mixHash(hash, hasSolo ? 1 : 0);
    for (const track of [...allAudioTracks, ...allVideoTracks]) {
      hash = mixHash(hash, hashString(track.id));
      hash = mixHash(hash, Boolean(track.audioMuted) ? 1 : 0);
      hash = mixHash(hash, Boolean(track.audioSolo) ? 1 : 0);
    }

    for (const item of effectiveAudioItems) {
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
    const allAudioTracks = audioTracks.value;
    const allVideoTracks = videoTracks.value;

    const hasSolo = [...allAudioTracks, ...allVideoTracks].some((t) => Boolean(t.audioSolo));

    const effectiveAudioTracks = hasSolo
      ? allAudioTracks.filter((t) => Boolean(t.audioSolo))
      : allAudioTracks.filter((t) => !t.audioMuted);

    const effectiveVideoTracksForAudio = hasSolo
      ? allVideoTracks.filter((t) => Boolean(t.audioSolo))
      : allVideoTracks.filter((t) => !t.audioMuted);

    const effectiveAudioItems = effectiveAudioTracks
      .flatMap((t) => t.items)
      .filter((it: TimelineTrackItem) => it.kind === 'clip');

    const enabledVideoAudioItems = effectiveVideoTracksForAudio
      .flatMap((t) => t.items)
      .filter(
        (it: TimelineTrackItem): it is Extract<TimelineTrackItem, { kind: 'clip' }> =>
          it.kind === 'clip' && !it.audioFromVideoDisabled,
      );

    let hash = mixHash(2166136261, effectiveAudioItems.length + enabledVideoAudioItems.length);
    hash = mixHash(hash, hasSolo ? 1 : 0);
    for (const track of [...allAudioTracks, ...allVideoTracks]) {
      hash = mixHash(hash, hashString(track.id));
      hash = mixHash(hash, Boolean(track.audioMuted) ? 1 : 0);
      hash = mixHash(hash, Boolean(track.audioSolo) ? 1 : 0);
    }

    for (const item of effectiveAudioItems) {
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
