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
        {
          id: '1',
          kind: 'audio',
          items: [
            {
              id: 'audio1',
              kind: 'clip',
              source: { path: 'test.mp3' },
              timelineRange: { startUs: 0, durationUs: 1000 },
              sourceRange: { startUs: 0, durationUs: 1000 },
            },
          ],
        },
        {
          id: '2',
          kind: 'video',
          items: [
            {
              id: 'item1',
              kind: 'clip',
              source: { path: 'test.mp4' },
              timelineRange: { startUs: 0, durationUs: 1000 },
              sourceRange: { startUs: 0, durationUs: 1000 },
            },
          ],
        },
      ],
    } as any;

    const { videoTrack, videoItems, audioTracks, audioItems } = useMonitorTimeline();

    expect(videoTrack.value?.id).toBe('2');
    expect(videoItems.value.length).toBe(1);
    expect(videoItems.value[0].id).toBe('item1');

    expect(audioTracks.value.length).toBe(1);
    expect(audioItems.value.length).toBe(1);
    expect(audioItems.value[0].id).toBe('audio1');
  });

  it('computes workerTimelineClips and workerAudioClips correctly', () => {
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
              sourceRange: { startUs: 0, durationUs: 1000 },
            },
            {
              id: 'item2',
              kind: 'other',
            },
          ],
        },
        {
          id: '1',
          kind: 'audio',
          items: [
            {
              id: 'audio1',
              kind: 'clip',
              source: { path: 'test1.mp3' },
              timelineRange: { startUs: 0, durationUs: 1000 },
              sourceRange: { startUs: 0, durationUs: 1000 },
            },
          ],
        },
      ],
    } as any;

    const { workerTimelineClips, workerAudioClips } = useMonitorTimeline();

    expect(workerTimelineClips.value.length).toBe(1);
    expect(workerTimelineClips.value[0].id).toBe('item1');
    expect(workerTimelineClips.value[0].source.path).toBe('test1.mp4');
    expect(workerTimelineClips.value[0].timelineRange.startUs).toBe(0);

    expect(workerAudioClips.value.length).toBe(1);
    expect(workerAudioClips.value[0].id).toBe('audio1');
    expect(workerAudioClips.value[0].source.path).toBe('test1.mp3');
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
              sourceRange: { startUs: 0, durationUs: 1000 },
            },
          ],
        },
        {
          id: '2',
          kind: 'audio',
          items: [
            {
              id: 'audio1',
              kind: 'clip',
              source: { path: 'test1.mp3' },
              timelineRange: { startUs: 0, durationUs: 1000 },
              sourceRange: { startUs: 0, durationUs: 1000 },
            },
          ],
        },
      ],
    } as any;

    const {
      clipSourceSignature,
      clipLayoutSignature,
      audioClipSourceSignature,
      audioClipLayoutSignature,
    } = useMonitorTimeline();

    const sig1 = clipSourceSignature.value;
    const layout1 = clipLayoutSignature.value;
    const audioSig1 = audioClipSourceSignature.value;
    const audioLayout1 = audioClipLayoutSignature.value;

    expect(typeof sig1).toBe('number');
    expect(typeof layout1).toBe('number');
    expect(typeof audioSig1).toBe('number');
    expect(typeof audioLayout1).toBe('number');

    // Changing layout should change layout signature but not source signature
    timelineStore.timelineDoc.tracks[0].items[0].timelineRange.startUs = 500;

    expect(clipSourceSignature.value).toBe(sig1);
    expect(clipLayoutSignature.value).not.toBe(layout1);

    timelineStore.timelineDoc.tracks[1].items[0].timelineRange.startUs = 500;

    expect(audioClipSourceSignature.value).toBe(audioSig1);
    expect(audioClipLayoutSignature.value).not.toBe(audioLayout1);
  });
});
