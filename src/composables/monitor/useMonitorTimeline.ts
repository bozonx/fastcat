import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import type { TimelineTrack, TimelineTrackItem } from '~/timeline/types';
import type { WorkerTimelineClip } from './types';
import { normalizeTimeUs } from '~/utils/monitor-time';
import { clampNumber, mergeBalance, mergeGain } from '~/utils/audio/envelope';
import { buildEffectiveAudioClipItems } from '~/utils/audio/track-bus';
import { sanitizeTimelineColor } from '~/utils/video-editor/utils';
import {
  applyAdjacentTransitions,
  createBackgroundWorkerClip,
  createBaseWorkerClip,
  createShapeWorkerClip,
  createTextWorkerClip,
  hashString,
  mixFloat,
  mixHash,
  mixTime,
  sanitizeMonitorSpeed,
} from './useMonitorTimeline.helpers';

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

    for (const [trackIndex, track] of videoTracks.entries()) {
      for (const item of track.items) {
        if (item.kind !== 'clip') continue;
        if ((item as any).disabled) continue;

        const clipType = (item as any).clipType ?? 'media';
        const base = createBaseWorkerClip({
          item,
          trackId: track.id,
          layer: trackCount - 1 - trackIndex,
          clipType,
        });

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
          clips.push(createBackgroundWorkerClip(base, (item as any).backgroundColor));
        } else if (clipType === 'text') {
          clips.push(
            createTextWorkerClip(base, {
              text: (item as any).text,
              style: (item as any).style,
            }),
          );
        } else if (clipType === 'shape') {
          clips.push(
            createShapeWorkerClip(base, {
              shapeType: (item as any).shapeType,
              fillColor: (item as any).fillColor,
              strokeColor: (item as any).strokeColor,
              strokeWidth: (item as any).strokeWidth,
              shapeConfig: (item as any).shapeConfig,
            }),
          );
        } else {
          clips.push(base);
        }
      }
    }

    applyAdjacentTransitions(clips);

    return clips;
  });

  const rawWorkerAudioClips = computed(() => {
    const clips: WorkerTimelineClip[] = [];

    function sanitizeSpeed(raw: unknown): number {
      return sanitizeMonitorSpeed(raw, 1) ?? 1;
    }

    const effectiveItems = buildEffectiveAudioClipItems({
      audioTracks: audioTracks.value,
      videoTracks: videoTracks.value,
      masterEffects: timelineStore.timelineDoc?.metadata?.fastcat?.masterEffects,
    });

    for (const item of effectiveItems) {
      if (item.kind !== 'clip') continue;
      if (item.clipType !== 'media' && item.clipType !== 'timeline') continue;
      if (!item.source?.path) continue;

      clips.push({
        kind: 'clip',
        clipType: 'media',
        id: item.id,
        trackId: item.trackId,
        layer: 0,
        speed: sanitizeSpeed((item as any).speed),
        audioGain: item.audioGain,
        audioBalance: item.audioBalance,
        audioFadeInUs: item.audioFadeInUs,
        audioFadeOutUs: item.audioFadeOutUs,
        audioFadeInCurve: item.audioFadeInCurve,
        audioFadeOutCurve: item.audioFadeOutCurve,
        transitionIn: item.transitionIn,
        transitionOut: item.transitionOut,
        effects: (item.effects ?? []).filter((effect) => effect?.target === 'audio'),
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

  const workerTimelineClips = ref<WorkerTimelineClip[]>([]);
  const workerAudioClips = ref<WorkerTimelineClip[]>([]);

  const safeDurationUs = computed(() => normalizeTimeUs(timelineStore.duration));

  const clipSourceSignature = computed(() => {
    let hash = mixHash(2166136261, videoItems.value.length);
    for (const item of videoItems.value) {
      hash = mixHash(hash, hashString(item.id));
      if (item.kind === 'clip') {
        hash = mixHash(hash, hashString(String((item as any).clipType ?? '')));
        if (item.clipType === 'media' && item.source?.path) {
          hash = mixHash(hash, hashString(item.source.path));
        } else if (item.clipType === 'background') {
          hash = mixHash(
            hash,
            hashString(sanitizeTimelineColor((item as any).backgroundColor, '#000000')),
          );
        } else if ((item as any).clipType === 'text') {
          hash = mixHash(hash, hashString(String((item as any).text ?? '')));
          const style = (item as any).style;
          if (style) {
            hash = mixHash(hash, hashString(JSON.stringify(style)));
          }
        } else if ((item as any).clipType === 'shape') {
          hash = mixHash(hash, hashString(String((item as any).shapeType ?? 'square')));
          hash = mixHash(hash, hashString(String((item as any).fillColor ?? '#ffffff')));
          hash = mixHash(hash, hashString(String((item as any).strokeColor ?? '#000000')));
          hash = mixFloat(hash, (item as any).strokeWidth ?? 0, 1000);
          const shapeConfig = (item as any).shapeConfig;
          if (shapeConfig) {
            hash = mixHash(hash, hashString(JSON.stringify(shapeConfig)));
          }
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

    const masterVideoEffects = (
      timelineStore.timelineDoc?.metadata?.fastcat?.masterEffects ?? []
    ).filter((effect) => effect?.target !== 'audio');
    if (masterVideoEffects.length > 0) {
      hash = mixHash(hash, hashString(JSON.stringify(masterVideoEffects)));
    }

    for (const track of videoTracks) {
      hash = mixHash(hash, hashString(track.id));
      hash = mixFloat(hash, track.opacity ?? 1, 1000);
      hash = mixHash(hash, hashString(String(track.blendMode ?? 'normal')));
      if (Array.isArray(track.effects)) {
        hash = mixHash(hash, hashString(JSON.stringify(track.effects)));
      }
    }

    for (const item of videoItems.value) {
      hash = mixHash(hash, hashString(item.id));
      hash = mixTime(hash, item.timelineRange.startUs);
      hash = mixTime(hash, item.timelineRange.durationUs);
      if (item.kind === 'clip') {
        hash = mixHash(hash, hashString(String((item as any).clipType ?? '')));
        hash = mixTime(hash, item.sourceRange.startUs);
        hash = mixTime(hash, item.sourceRange.durationUs);
        hash = mixHash(hash, hashString(JSON.stringify((item as any).transitionIn ?? null)));
        hash = mixHash(hash, hashString(JSON.stringify((item as any).transitionOut ?? null)));

        if (item.clipType === 'media') {
          hash = mixTime(hash, item.freezeFrameSourceUs ?? 0);
        }

        hash = mixFloat(hash, item.opacity ?? 1, 1000);
        hash = mixHash(hash, hashString(String(item.blendMode ?? 'normal')));
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
          const bgColor = sanitizeTimelineColor((item as any).backgroundColor, '#000000');
          if (bgColor) {
            hash = mixHash(hash, hashString(bgColor));
          }
        }

        if ((item as any).clipType === 'text') {
          hash = mixHash(hash, hashString(String((item as any).text ?? '')));
          const style = (item as any).style;
          if (style) {
            hash = mixHash(hash, hashString(JSON.stringify(style)));
          }
        }

        if ((item as any).clipType === 'shape') {
          hash = mixHash(hash, hashString(String((item as any).shapeType ?? 'square')));
          hash = mixHash(hash, hashString(String((item as any).fillColor ?? '#ffffff')));
          hash = mixHash(hash, hashString(String((item as any).strokeColor ?? '#000000')));
          hash = mixFloat(hash, (item as any).strokeWidth ?? 0, 1000);
          const shapeConfig = (item as any).shapeConfig;
          if (shapeConfig) {
            hash = mixHash(hash, hashString(JSON.stringify(shapeConfig)));
          }
        }

        const track = trackById.get((item as any).trackId);
        if (track) {
          hash = mixFloat(hash, track.opacity ?? 1, 1000);
          hash = mixHash(hash, hashString(String(track.blendMode ?? 'normal')));
        }
      }
    }
    return hash;
  });

  const audioClipLayoutSignature = computed(() => {
    const allAudioTracks = audioTracks.value;
    const allVideoTracks = videoTracks.value;

    const hasSolo = [...allAudioTracks, ...allVideoTracks].some((t) => Boolean(t.audioSolo));

    const effectiveItems = buildEffectiveAudioClipItems({
      audioTracks: allAudioTracks,
      videoTracks: allVideoTracks,
      masterEffects: timelineStore.timelineDoc?.metadata?.fastcat?.masterEffects,
    });

    let hash = mixHash(2166136261, effectiveItems.length);
    hash = mixHash(hash, hasSolo ? 1 : 0);
    const masterAudioEffects = (
      timelineStore.timelineDoc?.metadata?.fastcat?.masterEffects ?? []
    ).filter((effect) => effect?.target === 'audio');
    if (masterAudioEffects.length > 0) {
      hash = mixHash(hash, hashString(JSON.stringify(masterAudioEffects)));
    }
    for (const track of [...allAudioTracks, ...allVideoTracks]) {
      hash = mixHash(hash, hashString(track.id));
      hash = mixHash(hash, track.audioMuted ? 1 : 0);
      hash = mixHash(hash, track.audioSolo ? 1 : 0);

      hash = mixFloat(hash, mergeGain((track as any).audioGain, 1) ?? 1, 1000);
      hash = mixFloat(hash, mergeBalance((track as any).audioBalance, 0) ?? 0, 1000);

      const trackAudioEffects = (track.effects ?? []).filter(
        (effect) => effect?.target === 'audio',
      );
      if (trackAudioEffects.length > 0) {
        hash = mixHash(hash, hashString(JSON.stringify(trackAudioEffects)));
      }
    }

    for (const item of effectiveItems) {
      hash = mixHash(hash, hashString(item.id));
      hash = mixTime(hash, item.timelineRange.startUs);
      hash = mixTime(hash, item.timelineRange.durationUs);
      if (item.kind === 'clip') {
        hash = mixTime(hash, item.sourceRange.startUs);
        hash = mixTime(hash, item.sourceRange.durationUs);

        hash = mixFloat(hash, (item as any).speed ?? 1, 1000);

        hash = mixFloat(hash, (item as any).audioGain ?? 1, 1000);
        hash = mixFloat(hash, (item as any).audioBalance ?? 0, 1000);
        hash = mixTime(hash, Math.round(Number((item as any).audioFadeInUs ?? 0)));
        hash = mixTime(hash, Math.round(Number((item as any).audioFadeOutUs ?? 0)));

        const audioEffects = Array.isArray((item as any).effects)
          ? (item as any).effects.filter((effect: any) => effect?.target === 'audio')
          : null;
        if (audioEffects && audioEffects.length > 0) {
          hash = mixHash(hash, hashString(JSON.stringify(audioEffects)));
        }
      }
    }
    return hash;
  });

  const audioClipSourceSignature = computed(() => {
    const allAudioTracks = audioTracks.value;
    const allVideoTracks = videoTracks.value;

    const hasSolo = [...allAudioTracks, ...allVideoTracks].some((t) => Boolean(t.audioSolo));

    const effectiveItems = buildEffectiveAudioClipItems({
      audioTracks: allAudioTracks,
      videoTracks: allVideoTracks,
      masterEffects: timelineStore.timelineDoc?.metadata?.fastcat?.masterEffects,
    });

    let hash = mixHash(2166136261, effectiveItems.length);
    hash = mixHash(hash, hasSolo ? 1 : 0);
    for (const track of [...allAudioTracks, ...allVideoTracks]) {
      hash = mixHash(hash, hashString(track.id));
      hash = mixHash(hash, track.audioMuted ? 1 : 0);
      hash = mixHash(hash, track.audioSolo ? 1 : 0);
    }

    for (const item of effectiveItems) {
      hash = mixHash(hash, hashString(item.id));
      if (item.kind === 'clip') {
        if (item.clipType === 'media' && item.source?.path) {
          hash = mixHash(hash, hashString(item.source.path));
        }

        hash = mixFloat(hash, (item as any).speed ?? 1, 1000);
      }
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
