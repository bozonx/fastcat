import { computed, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import type {
  TimelineBackgroundClipItem,
  TimelineClipItem,
  TimelineShapeClipItem,
  TimelineTextClipItem,
  TimelineTrack,
  TimelineTrackItem,
} from '~/timeline/types';
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

  function getItemSpeed(item: TimelineClipItem): number | undefined {
    return item.speed;
  }

  function getTrackAudioGain(track: TimelineTrack): number | undefined {
    return track.audioGain;
  }

  function getTrackAudioBalance(track: TimelineTrack): number | undefined {
    return track.audioBalance;
  }

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
  const visibleVideoTracks = computed(() =>
    videoTracks.value.filter((track) => !track.videoHidden),
  );
  const masterEffects = computed(
    () => timelineStore.timelineDoc?.metadata?.fastcat?.masterEffects ?? [],
  );
  const combinedAudioTracks = computed(() => [...audioTracks.value, ...videoTracks.value]);
  const effectiveAudioItems = computed(() =>
    buildEffectiveAudioClipItems({
      audioTracks: audioTracks.value,
      videoTracks: videoTracks.value,
      masterEffects: masterEffects.value,
    }),
  );
  const hasSoloAudio = computed(() =>
    combinedAudioTracks.value.some((track) => Boolean(track.audioSolo)),
  );

  const videoItems = computed(() =>
    visibleVideoTracks.value.flatMap((track) =>
      (track.items ?? []).filter((it: TimelineTrackItem) => it.kind === 'clip'),
    ),
  );

  const audioItems = computed(() =>
    audioTracks.value
      .flatMap((track) => track.items)
      .filter((it: TimelineTrackItem) => it.kind === 'clip'),
  );

  const rawWorkerTimelineClips = computed(() => {
    const clips: WorkerTimelineClip[] = [];
    const trackCount = visibleVideoTracks.value.length;

    for (const [trackIndex, track] of visibleVideoTracks.value.entries()) {
      for (const item of track.items) {
        if (item.kind !== 'clip') continue;
        if (item.disabled) continue;

        const clipType = item.clipType;
        const base = createBaseWorkerClip({
          item,
          trackId: track.id,
          layer: trackCount - 1 - trackIndex,
          clipType: clipType === 'timeline' ? 'media' : clipType,
        });

        if (clipType === 'media' || clipType === 'timeline') {
          const path = item.source?.path;
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
          clips.push(
            createBackgroundWorkerClip(base, (item as TimelineBackgroundClipItem).backgroundColor),
          );
        } else if (clipType === 'text') {
          const textItem = item as TimelineTextClipItem;
          clips.push(
            createTextWorkerClip(base, {
              text: textItem.text,
              style: textItem.style,
            }),
          );
        } else if (clipType === 'shape') {
          const shapeItem = item as TimelineShapeClipItem;
          clips.push(
            createShapeWorkerClip(base, {
              shapeType: shapeItem.shapeType,
              fillColor: shapeItem.fillColor,
              strokeColor: shapeItem.strokeColor,
              strokeWidth: shapeItem.strokeWidth,
              shapeConfig: shapeItem.shapeConfig,
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

    for (const item of effectiveAudioItems.value) {
      if (item.kind !== 'clip') continue;
      if (item.clipType !== 'media' && item.clipType !== 'timeline') continue;
      if (!item.source?.path) continue;

      clips.push({
        kind: 'clip',
        clipType: 'media',
        id: item.id,
        trackId: item.trackId,
        layer: 0,
        speed: sanitizeSpeed(getItemSpeed(item)),
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
  const workerTimelinePayload = ref<any[]>([]);

  const safeDurationUs = computed(() => normalizeTimeUs(timelineStore.duration));

  const clipSourceSignature = computed(() => {
    let hash = mixHash(2166136261, videoItems.value.length);
    for (const item of videoItems.value) {
      hash = mixHash(hash, hashString(item.id));
      if (item.kind === 'clip') {
        hash = mixHash(hash, hashString(String(item.clipType ?? '')));
        if (item.clipType === 'media' && item.source?.path) {
          hash = mixHash(hash, hashString(item.source.path));
        }

        if (item.mask?.source?.path) {
          hash = mixHash(hash, hashString(item.mask.source.path));
        }

        if (item.clipType === 'background') {
          hash = mixHash(
            hash,
            hashString(
              sanitizeTimelineColor(
                (item as TimelineBackgroundClipItem).backgroundColor,
                '#000000',
              ),
            ),
          );
        } else if (item.clipType === 'text') {
          const textItem = item as TimelineTextClipItem;
          hash = mixHash(hash, hashString(String(textItem.text ?? '')));
          const style = textItem.style;
          if (style) {
            hash = mixHash(hash, hashString(JSON.stringify(style)));
          }
        } else if (item.clipType === 'shape') {
          const shapeItem = item as TimelineShapeClipItem;
          hash = mixHash(hash, hashString(String(shapeItem.shapeType ?? 'square')));
          hash = mixHash(hash, hashString(String(shapeItem.fillColor ?? '#ffffff')));
          hash = mixHash(hash, hashString(String(shapeItem.strokeColor ?? '#000000')));
          hash = mixFloat(hash, shapeItem.strokeWidth ?? 0, 1000);
          const shapeConfig = shapeItem.shapeConfig;
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
    const trackById = new Map<string, TimelineTrack>(
      visibleVideoTracks.value.map((t) => [t.id, t]),
    );

    const masterVideoEffects = masterEffects.value.filter((effect) => effect?.target !== 'audio');
    if (masterVideoEffects.length > 0) {
      hash = mixHash(hash, hashString(JSON.stringify(masterVideoEffects)));
    }

    for (const track of visibleVideoTracks.value) {
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
        hash = mixHash(hash, hashString(String(item.clipType ?? '')));
        hash = mixTime(hash, item.sourceRange.startUs);
        hash = mixTime(hash, item.sourceRange.durationUs);
        hash = mixHash(hash, hashString(JSON.stringify(item.transitionIn ?? null)));
        hash = mixHash(hash, hashString(JSON.stringify(item.transitionOut ?? null)));

        if (item.clipType === 'media') {
          hash = mixTime(hash, item.freezeFrameSourceUs ?? 0);
        }

        hash = mixFloat(hash, item.opacity ?? 1, 1000);
        hash = mixHash(hash, hashString(String(item.blendMode ?? 'normal')));
        hash = mixFloat(hash, getItemSpeed(item) ?? 1, 1000);

        const clipEffects = Array.isArray(item.effects) ? item.effects : null;
        if (clipEffects) {
          hash = mixHash(hash, hashString(JSON.stringify(clipEffects)));
        }

        const transform = item.transform;
        if (transform) {
          hash = mixHash(hash, hashString(JSON.stringify(transform)));
        }

        const mask = item.mask;
        if (mask) {
          hash = mixHash(hash, hashString(JSON.stringify(mask)));
        }

        if (item.clipType === 'background') {
          const bgColor = sanitizeTimelineColor(
            (item as TimelineBackgroundClipItem).backgroundColor,
            '#000000',
          );
          if (bgColor) {
            hash = mixHash(hash, hashString(bgColor));
          }
        }

        if (item.clipType === 'text') {
          const textItem = item as TimelineTextClipItem;
          hash = mixHash(hash, hashString(String(textItem.text ?? '')));
          const style = textItem.style;
          if (style) {
            hash = mixHash(hash, hashString(JSON.stringify(style)));
          }
        }

        if (item.clipType === 'shape') {
          const shapeItem = item as TimelineShapeClipItem;
          hash = mixHash(hash, hashString(String(shapeItem.shapeType ?? 'square')));
          hash = mixHash(hash, hashString(String(shapeItem.fillColor ?? '#ffffff')));
          hash = mixHash(hash, hashString(String(shapeItem.strokeColor ?? '#000000')));
          hash = mixFloat(hash, shapeItem.strokeWidth ?? 0, 1000);
          const shapeConfig = shapeItem.shapeConfig;
          if (shapeConfig) {
            hash = mixHash(hash, hashString(JSON.stringify(shapeConfig)));
          }
        }

        const track = trackById.get(item.trackId);
        if (track) {
          hash = mixFloat(hash, track.opacity ?? 1, 1000);
          hash = mixHash(hash, hashString(String(track.blendMode ?? 'normal')));
        }
      }
    }
    return hash;
  });

  const audioClipLayoutSignature = computed(() => {
    let hash = mixHash(2166136261, effectiveAudioItems.value.length);
    hash = mixHash(hash, hasSoloAudio.value ? 1 : 0);
    const masterAudioEffects = masterEffects.value.filter((effect) => effect?.target === 'audio');
    if (masterAudioEffects.length > 0) {
      hash = mixHash(hash, hashString(JSON.stringify(masterAudioEffects)));
    }
    for (const track of combinedAudioTracks.value) {
      hash = mixHash(hash, hashString(track.id));
      hash = mixHash(hash, track.audioMuted ? 1 : 0);
      hash = mixHash(hash, track.audioSolo ? 1 : 0);

      hash = mixFloat(hash, mergeGain(getTrackAudioGain(track), 1) ?? 1, 1000);
      hash = mixFloat(hash, mergeBalance(getTrackAudioBalance(track), 0) ?? 0, 1000);

      const trackAudioEffects = (track.effects ?? []).filter(
        (effect) => effect?.target === 'audio',
      );
      if (trackAudioEffects.length > 0) {
        hash = mixHash(hash, hashString(JSON.stringify(trackAudioEffects)));
      }
    }

    for (const item of effectiveAudioItems.value) {
      hash = mixHash(hash, hashString(item.id));
      hash = mixTime(hash, item.timelineRange.startUs);
      hash = mixTime(hash, item.timelineRange.durationUs);
      if (item.kind === 'clip') {
        hash = mixTime(hash, item.sourceRange.startUs);
        hash = mixTime(hash, item.sourceRange.durationUs);

        hash = mixFloat(hash, getItemSpeed(item) ?? 1, 1000);

        hash = mixFloat(hash, item.audioGain ?? 1, 1000);
        hash = mixFloat(hash, item.audioBalance ?? 0, 1000);
        hash = mixTime(hash, Math.round(Number(item.audioFadeInUs ?? 0)));
        hash = mixTime(hash, Math.round(Number(item.audioFadeOutUs ?? 0)));

        const audioEffects = Array.isArray(item.effects)
          ? item.effects.filter((effect) => effect?.target === 'audio')
          : null;
        if (audioEffects && audioEffects.length > 0) {
          hash = mixHash(hash, hashString(JSON.stringify(audioEffects)));
        }
      }
    }
    return hash;
  });

  const audioClipSourceSignature = computed(() => {
    let hash = mixHash(2166136261, effectiveAudioItems.value.length);
    hash = mixHash(hash, hasSoloAudio.value ? 1 : 0);
    for (const track of combinedAudioTracks.value) {
      hash = mixHash(hash, hashString(track.id));
      hash = mixHash(hash, track.audioMuted ? 1 : 0);
      hash = mixHash(hash, track.audioSolo ? 1 : 0);
    }

    for (const item of effectiveAudioItems.value) {
      hash = mixHash(hash, hashString(item.id));
      if (item.kind === 'clip') {
        if (item.clipType === 'media' && item.source?.path) {
          hash = mixHash(hash, hashString(item.source.path));
        }

        hash = mixFloat(hash, getItemSpeed(item) ?? 1, 1000);
      }
    }
    return hash;
  });

  return {
    videoItems,
    workerTimelineClips,
    workerAudioClips,
    workerTimelinePayload,
    rawWorkerTimelineClips,
    rawWorkerAudioClips,
    safeDurationUs,
    clipSourceSignature,
    clipLayoutSignature,
    audioClipSourceSignature,
    audioClipLayoutSignature,
  };
}
