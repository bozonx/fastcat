import { computed, ref } from 'vue';
import type { TimelineClipItem, TimelineTrack } from '~/timeline/types';
import { useTimelineStore } from '~/stores/timeline.store';
import { useMediaStore } from '~/stores/media.store';

/**
 * State + handlers for the clip speed modal, extracted from `TimelineTracks.vue`.
 * `tracks` is supplied as a getter so the modal reflects the currently rendered
 * track list.
 */
export function useTimelineSpeedModal(tracks: () => TimelineTrack[]) {
  const timelineStore = useTimelineStore();
  const mediaStore = useMediaStore();

  const speedModal = ref<{ open: boolean; trackId: string; itemId: string; speed: number } | null>(
    null,
  );

  function openSpeedModal(
    trackId: string,
    itemId: string,
    currentSpeed: number | null | undefined,
  ) {
    speedModal.value = {
      open: true,
      trackId,
      itemId,
      speed: typeof currentSpeed === 'number' ? currentSpeed : 1,
    };
  }

  async function saveSpeedModal() {
    if (!speedModal.value) return;
    const { trackId, itemId, speed } = speedModal.value;
    if (Math.abs(speed) < 0.1) return;
    timelineStore.updateClipProperties(trackId, itemId, { speed });
    speedModal.value.open = false;
    await timelineStore.requestTimelineSave({ immediate: true });
  }

  const speedModalTargetHasAudio = computed(() => {
    if (!speedModal.value) return false;
    const track = tracks().find((t) => t.id === speedModal.value!.trackId);
    const clip = track?.items.find(
      (it): it is TimelineClipItem => it.id === speedModal.value!.itemId && it.kind === 'clip',
    );
    if (!clip || (track?.kind === 'video' && clip.audioMuted)) return false;
    if (track?.kind === 'audio') return true;
    return Boolean(clip.source?.path && mediaStore.getCachedMetadata(clip.source.path)?.audio);
  });

  return {
    speedModal,
    openSpeedModal,
    saveSpeedModal,
    speedModalTargetHasAudio,
  };
}
