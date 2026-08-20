import type { TimelineClipActionPayload } from '~/timeline/types';
import { useTimelineStore } from '~/stores/timeline.store';

export function useTimelineClipActions() {
  const timelineStore = useTimelineStore();

  async function applyClipAction(payload: TimelineClipActionPayload) {
    if (payload.action === 'extractAudio') {
      const createdItemIds = await timelineStore.extractAudioToTrack({
        videoTrackId: payload.trackId,
        videoItemId: payload.itemId,
      });
      if (createdItemIds.length > 0) {
        timelineStore.selectTimelineItems([payload.itemId]);
      }
    } else if (payload.action === 'freezeFrame') {
      timelineStore.setClipFreezeFrameFromPlayhead({
        trackId: payload.trackId,
        itemId: payload.itemId,
      });
    } else if (payload.action === 'resetFreezeFrame') {
      timelineStore.resetClipFreezeFrame({ trackId: payload.trackId, itemId: payload.itemId });
    }

    await timelineStore.requestTimelineSave({ immediate: true });
  }

  return {
    applyClipAction,
  };
}
