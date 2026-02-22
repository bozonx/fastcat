import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useMonitorTimeline } from '~/composables/monitor/useMonitorTimeline';
import { useTimelineStore } from '~/stores/timeline.store';

describe('useMonitorTimeline', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('provides computed videoTrack', () => {
    const timelineStore = useTimelineStore();
    timelineStore.timelineDoc = {
      tracks: [
        { id: '1', kind: 'audio', items: [] },
        { id: '2', kind: 'video', items: [{ id: 'item1', kind: 'clip', source: { path: 'test.mp4' }, timelineRange: { startUs: 0, durationUs: 1000 }, sourceRange: { startUs: 0, durationUs: 1000 } }] },
      ]
    } as any;

    const { videoTrack, videoItems } = useMonitorTimeline();
    
    expect(videoTrack.value?.id).toBe('2');
    expect(videoItems.value.length).toBe(1);
    expect(videoItems.value[0].id).toBe('item1');
  });

  it('computes workerTimelineClips correctly', () => {
    const timelineStore = useTimelineStore();
    timelineStore.timelineDoc = {
      tracks: [
        {
          id: '2',
          kind: 'video',
          items: [
            { 
              id: 'item1', 
              kind: 'clip', 
              source: { path: 'test1.mp4' }, 
              timelineRange: { startUs: 0, durationUs: 1000 }, 
              sourceRange: { startUs: 0, durationUs: 1000 } 
            },
            {
              id: 'item2',
              kind: 'other',
            }
          ]
        },
      ]
    } as any;

    const { workerTimelineClips } = useMonitorTimeline();
    
    expect(workerTimelineClips.value.length).toBe(1);
    expect(workerTimelineClips.value[0].id).toBe('item1');
    expect(workerTimelineClips.value[0].source.path).toBe('test1.mp4');
    expect(workerTimelineClips.value[0].timelineRange.startUs).toBe(0);
  });

  it('computes signatures correctly', () => {
    const timelineStore = useTimelineStore();
    timelineStore.timelineDoc = {
      tracks: [
        {
          id: '1',
          kind: 'video',
          items: [
            { 
              id: 'item1', 
              kind: 'clip', 
              source: { path: 'test1.mp4' }, 
              timelineRange: { startUs: 0, durationUs: 1000 }, 
              sourceRange: { startUs: 0, durationUs: 1000 } 
            }
          ]
        },
      ]
    } as any;

    const { clipSourceSignature, clipLayoutSignature } = useMonitorTimeline();
    
    const sig1 = clipSourceSignature.value;
    const layout1 = clipLayoutSignature.value;
    
    expect(typeof sig1).toBe('number');
    expect(typeof layout1).toBe('number');
    
    // Changing layout should change layout signature but not source signature
    timelineStore.timelineDoc.tracks[0].items[0].timelineRange.startUs = 500;
    
    expect(clipSourceSignature.value).toBe(sig1);
    expect(clipLayoutSignature.value).not.toBe(layout1);
  });
});
