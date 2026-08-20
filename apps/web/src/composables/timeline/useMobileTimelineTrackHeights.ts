import { computed, type ComputedRef } from 'vue';
import type { TimelineTrack } from '~/timeline/types';
import type { useTimelineStore } from '~/stores/timeline.store';

export interface UseMobileTimelineTrackHeightsOptions {
  tracks: ComputedRef<TimelineTrack[]>;
  timelineStore: ReturnType<typeof useTimelineStore>;
}

export function useMobileTimelineTrackHeights(options: UseMobileTimelineTrackHeightsOptions) {
  const { tracks, timelineStore } = options;

  const trackHeights = computed(() => {
    const heights: Record<string, number> = {};
    const enlarged = timelineStore.mobileTrackHeightsEnlarged;
    for (const t of tracks.value) {
      const multiplier = enlarged[t.id] ? 3 : 1;
      heights[t.id] = (t.kind === 'video' ? 64 : 48) * multiplier;
    }
    return heights;
  });

  function toggleTrackHeightEnlarged(trackId: string) {
    const enlarged = { ...timelineStore.mobileTrackHeightsEnlarged };
    if (enlarged[trackId]) {
      Reflect.deleteProperty(enlarged, trackId);
    } else {
      enlarged[trackId] = true;
    }
    timelineStore.mobileTrackHeightsEnlarged = enlarged;
  }

  return {
    trackHeights,
    toggleTrackHeightEnlarged,
  };
}
