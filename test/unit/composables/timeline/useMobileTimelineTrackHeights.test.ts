/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { computed } from 'vue';
import { useMobileTimelineTrackHeights } from '~/composables/timeline/useMobileTimelineTrackHeights';
import type { TimelineTrack } from '~/timeline/types';

const mockTimelineStore = {
  mobileTrackHeightsEnlarged: {} as Record<string, boolean>,
};

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => mockTimelineStore,
}));

describe('useMobileTimelineTrackHeights', () => {
  it('returns default heights for video and audio tracks', () => {
    const tracks = computed<TimelineTrack[]>(() => [
      { id: 'v1', kind: 'video', name: 'Video 1', items: [] } as TimelineTrack,
      { id: 'a1', kind: 'audio', name: 'Audio 1', items: [] } as TimelineTrack,
    ]);

    const { trackHeights } = useMobileTimelineTrackHeights({
      tracks,
      timelineStore: mockTimelineStore as any,
    });

    expect(trackHeights.value).toEqual({
      v1: 64,
      a1: 48,
    });
  });

  it('triples height for enlarged tracks', () => {
    mockTimelineStore.mobileTrackHeightsEnlarged = { v1: true };

    const tracks = computed<TimelineTrack[]>(() => [
      { id: 'v1', kind: 'video', name: 'Video 1', items: [] } as TimelineTrack,
      { id: 'a1', kind: 'audio', name: 'Audio 1', items: [] } as TimelineTrack,
    ]);

    const { trackHeights } = useMobileTimelineTrackHeights({
      tracks,
      timelineStore: mockTimelineStore as any,
    });

    expect(trackHeights.value).toEqual({
      v1: 192,
      a1: 48,
    });
  });

  it('toggles enlarged state without mutating the original object', () => {
    mockTimelineStore.mobileTrackHeightsEnlarged = {};

    const tracks = computed<TimelineTrack[]>(() => [
      { id: 'v1', kind: 'video', name: 'Video 1', items: [] } as TimelineTrack,
    ]);

    const { toggleTrackHeightEnlarged } = useMobileTimelineTrackHeights({
      tracks,
      timelineStore: mockTimelineStore as any,
    });

    toggleTrackHeightEnlarged('v1');
    expect(mockTimelineStore.mobileTrackHeightsEnlarged).toEqual({ v1: true });

    toggleTrackHeightEnlarged('v1');
    expect(mockTimelineStore.mobileTrackHeightsEnlarged).toEqual({});
  });
});
