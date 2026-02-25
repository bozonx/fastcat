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

  const rawWorkerTimelineClips = computed(() => {
    const docTracks = (timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined) ?? [];
    const clips: WorkerTimelineClip[] = [];
    const videoTracks = docTracks.filter((track) => track.kind === 'video' && !track.videoHidden);
    const trackCount = videoTracks.length;

    function sanitizeTransition(raw: unknown): { type: string; durationUs: number } | undefined {
      if (!raw || typeof raw !== 'object') return undefined;
      const anyRaw = raw as any;
      const type = typeof anyRaw.type === 'string' ? anyRaw.type : '';
      const durationUs = Number(anyRaw.durationUs);
      if (!type) return undefined;
      if (!Number.isFinite(durationUs)) return undefined;
      return {
        type,
        durationUs: Math.max(0, Math.round(durationUs)),
      };
    }

    for (const [trackIndex, track] of videoTracks.entries()) {
      for (const item of track.items) {
        if (item.kind !== 'clip') continue;

        const clipType = (item as any).clipType ?? 'media';

        const clipEffects = item.effects ? JSON.parse(JSON.stringify(item.effects)) : undefined;
        const trackEffects = track.effects ? JSON.parse(JSON.stringify(track.effects)) : undefined;
        const effects =
          clipEffects && trackEffects
            ? [...clipEffects, ...trackEffects]
            : (clipEffects ?? trackEffects);

        const base: WorkerTimelineClip = {
          kind: 'clip',
          clipType,
          id: item.id,
          layer: trackCount - 1 - trackIndex,
          speed: (item as any).speed,
          freezeFrameSourceUs: item.freezeFrameSourceUs,
          opacity: item.opacity,
          effects,
          transform: (item as any).transform,
          transitionIn: sanitizeTransition((item as any).transitionIn),
          transitionOut: sanitizeTransition((item as any).transitionOut),
          timelineRange: {
            startUs: item.timelineRange.startUs,
            durationUs: item.timelineRange.durationUs,
          },
          sourceRange: {
            startUs: item.sourceRange.startUs,
            durationUs: item.sourceRange.durationUs,
          },
        };

        if (clipType === 'media' || clipType === 'timeline') {
          const path = (item as any).source?.path;
          if (!path) continue;
          if (clipType === 'timeline') {
            clips.push({
              ...base,
              source: { path },
              clipType: 'media',
            });
          } else {
            clips.push({ ...base, source: { path } });
          }
        } else if (clipType === 'background') {
          clips.push({
            ...base,
            backgroundColor: String((item as any).backgroundColor ?? '#000000'),
          });
        } else {
          clips.push(base);
        }
      }
    }
    return clips;
  });

  const rawWorkerAudioClips = computed(() => {
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
      const clipType = (item as any).clipType ?? 'media';
      if (clipType !== 'media' && clipType !== 'timeline') continue;
      const path = (item as any).source?.path;
      if (!path) continue;
      clips.push({
        kind: 'clip',
        clipType: 'media',
        id: item.id,
        layer: 0,
        speed: (item as any).speed,
        source: {
          path,
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
        const clipType = (item as any).clipType ?? 'media';
        if (clipType !== 'media' && clipType !== 'timeline') continue;
        if ((item as any).audioFromVideoDisabled) continue;
        const path = (item as any).source?.path;
        if (!path) continue;

        clips.push({
          kind: 'clip',
          clipType: 'media',
          id: `${item.id}__audio`,
          layer: 0,
          speed: (item as any).speed,
          source: {
            path,
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

  const workerTimelineClips = ref<WorkerTimelineClip[]>([]);
  const workerAudioClips = ref<WorkerTimelineClip[]>([]);

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
        hash = mixHash(hash, hashString(String((item as any).clipType ?? '')));
        if (item.clipType === 'media' && item.source?.path) {
          hash = mixHash(hash, hashString(item.source.path));
        } else if (item.clipType === 'background') {
          hash = mixHash(hash, hashString((item as any).backgroundColor ?? '#000000'));
        }
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
        hash = mixHash(hash, hashString(String((item as any).clipType ?? '')));
        hash = mixTime(hash, item.sourceRange.startUs);
        hash = mixTime(hash, item.sourceRange.durationUs);

        if (item.clipType === 'media') {
          hash = mixTime(hash, item.freezeFrameSourceUs ?? 0);
        }

        hash = mixFloat(hash, item.opacity ?? 1, 1000);
        hash = mixFloat(hash, (item as any).speed ?? 1, 1000);

        const clipEffects = Array.isArray((item as any).effects) ? (item as any).effects : null;
        if (clipEffects) {
          hash = mixHash(hash, hashString(JSON.stringify(clipEffects)));
        }

        const transform = (item as any).transform;
        if (transform) {
          hash = mixHash(hash, hashString(JSON.stringify(transform)));
        }

        if (item.clipType === 'background') {
          const bgColor = (item as any).backgroundColor;
          if (bgColor) {
            hash = mixHash(hash, hashString(bgColor));
          }
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

        hash = mixFloat(hash, (item as any).speed ?? 1, 1000);
      }
    }
    for (const item of enabledVideoAudioItems) {
      hash = mixHash(hash, hashString(`${item.id}__audio`));
      hash = mixTime(hash, item.timelineRange.startUs);
      hash = mixTime(hash, item.timelineRange.durationUs);
      hash = mixTime(hash, item.sourceRange.startUs);
      hash = mixTime(hash, item.sourceRange.durationUs);

      hash = mixFloat(hash, (item as any).speed ?? 1, 1000);
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
        if (item.clipType === 'media' && item.source?.path) {
          hash = mixHash(hash, hashString(item.source.path));
        }

        hash = mixFloat(hash, (item as any).speed ?? 1, 1000);
      }
    }
    for (const item of enabledVideoAudioItems) {
      hash = mixHash(hash, hashString(`${item.id}__audio`));
      if (item.clipType === 'media' && item.source?.path) {
        hash = mixHash(hash, hashString(item.source.path));
      }

      hash = mixFloat(hash, (item as any).speed ?? 1, 1000);
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
    rawWorkerTimelineClips,
    rawWorkerAudioClips,
  };
}
