import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useMonitorTimeline } from '../../../src/composables/monitor/useMonitorTimeline';
import { useTimelineStore } from '../../../src/stores/timeline.store';

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

    const { videoTracks, videoItems, audioTracks, audioItems } = useMonitorTimeline();

    expect(videoTracks.value.length).toBe(1);
    expect(videoTracks.value[0].id).toBe('2');
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
          videoHidden: false,
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
          audioMuted: false,
          audioSolo: false,
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
    expect(workerTimelineClips.value[0].clipType).toBe('media');
    expect(workerTimelineClips.value[0].source?.path).toBe('test1.mp4');
    expect(workerTimelineClips.value[0].timelineRange.startUs).toBe(0);
    // Single video track: layer should be 0 (trackCount - 1 - 0 = 0)
    expect(workerTimelineClips.value[0].layer).toBe(0);

    expect(workerAudioClips.value.length).toBe(2);
    expect(workerAudioClips.value.find((x: any) => x.id === 'audio1')?.source?.path).toBe(
      'test1.mp3',
    );
    expect(workerAudioClips.value.find((x: any) => x.id === 'item1__audio')?.source?.path).toBe(
      'test1.mp4',
    );
  });

  it('assigns inverted layers so first track (top in UI) renders on top', () => {
    const timelineStore = useTimelineStore();
    timelineStore.timelineDoc = {
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          videoHidden: false,
          items: [
            {
              id: 'clip1',
              kind: 'clip',
              source: { path: 'a.mp4' },
              timelineRange: { startUs: 0, durationUs: 1000 },
              sourceRange: { startUs: 0, durationUs: 1000 },
            },
          ],
        },
        {
          id: 'v2',
          kind: 'video',
          videoHidden: false,
          items: [
            {
              id: 'clip2',
              kind: 'clip',
              source: { path: 'b.mp4' },
              timelineRange: { startUs: 0, durationUs: 1000 },
              sourceRange: { startUs: 0, durationUs: 1000 },
            },
          ],
        },
      ],
    } as any;

    const { workerTimelineClips } = useMonitorTimeline();

    const clip1 = workerTimelineClips.value.find((c: any) => c.id === 'clip1');
    const clip2 = workerTimelineClips.value.find((c: any) => c.id === 'clip2');

    // v1 is track[0] (top in UI) → layer = 2-1-0 = 1 (renders on top)
    expect(clip1?.layer).toBe(1);
    // v2 is track[1] (bottom in UI) → layer = 2-1-1 = 0 (renders below)
    expect(clip2?.layer).toBe(0);
    expect(clip1!.layer).toBeGreaterThan(clip2!.layer);
  });

  it('workerAudioClips does not duplicate audio from video clips', () => {
    const timelineStore = useTimelineStore();
    timelineStore.timelineDoc = {
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          videoHidden: false,
          items: [
            {
              id: 'vclip1',
              kind: 'clip',
              source: { path: 'video.mp4' },
              timelineRange: { startUs: 0, durationUs: 1000 },
              sourceRange: { startUs: 0, durationUs: 1000 },
            },
            {
              id: 'vclip2',
              kind: 'clip',
              source: { path: 'video2.mp4' },
              audioFromVideoDisabled: true,
              timelineRange: { startUs: 1000, durationUs: 1000 },
              sourceRange: { startUs: 0, durationUs: 1000 },
            },
          ],
        },
        {
          id: 'a1',
          kind: 'audio',
          audioMuted: false,
          audioSolo: false,
          items: [
            {
              id: 'aclip1',
              kind: 'clip',
              source: { path: 'audio.mp3' },
              timelineRange: { startUs: 0, durationUs: 1000 },
              sourceRange: { startUs: 0, durationUs: 1000 },
            },
          ],
        },
      ],
    } as any;

    const { workerAudioClips } = useMonitorTimeline();

    // Should have: aclip1 + vclip1__audio (vclip2 is disabled)
    expect(workerAudioClips.value.length).toBe(2);
    expect(workerAudioClips.value.find((c: any) => c.id === 'aclip1')).toBeDefined();
    expect(workerAudioClips.value.find((c: any) => c.id === 'vclip1__audio')).toBeDefined();
    // Disabled audio must NOT appear
    expect(workerAudioClips.value.find((c: any) => c.id === 'vclip2__audio')).toBeUndefined();
  });

  it('computes signatures correctly', () => {
    const timelineStore = useTimelineStore();
    timelineStore.timelineDoc = {
      tracks: [
        {
          id: '1',
          kind: 'video',
          videoHidden: false,
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
          audioMuted: false,
          audioSolo: false,
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

  it('filters hidden video tracks from workerTimelineClips', () => {
    const timelineStore = useTimelineStore();
    timelineStore.timelineDoc = {
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          videoHidden: true,
          items: [
            {
              id: 'clip1',
              kind: 'clip',
              source: { path: 'a.mp4' },
              timelineRange: { startUs: 0, durationUs: 1000 },
              sourceRange: { startUs: 0, durationUs: 1000 },
            },
          ],
        },
      ],
    } as any;

    const { workerTimelineClips } = useMonitorTimeline();
    expect(workerTimelineClips.value.length).toBe(0);
  });

  it('applies audio solo/mute when building workerAudioClips', () => {
    const timelineStore = useTimelineStore();
    timelineStore.timelineDoc = {
      tracks: [
        {
          id: 'a1',
          kind: 'audio',
          audioMuted: true,
          audioSolo: false,
          items: [
            {
              id: 'aclip1',
              kind: 'clip',
              source: { path: 'audio1.mp3' },
              timelineRange: { startUs: 0, durationUs: 1000 },
              sourceRange: { startUs: 0, durationUs: 1000 },
            },
          ],
        },
        {
          id: 'a2',
          kind: 'audio',
          audioMuted: false,
          audioSolo: true,
          items: [
            {
              id: 'aclip2',
              kind: 'clip',
              source: { path: 'audio2.mp3' },
              timelineRange: { startUs: 0, durationUs: 1000 },
              sourceRange: { startUs: 0, durationUs: 1000 },
            },
          ],
        },
      ],
    } as any;

    const { workerAudioClips } = useMonitorTimeline();
    expect(workerAudioClips.value.length).toBe(1);
    expect(workerAudioClips.value[0].id).toBe('aclip2');
  });

  it('applies video track solo/mute to __audio clips extracted from video', () => {
    const timelineStore = useTimelineStore();
    timelineStore.timelineDoc = {
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          videoHidden: false,
          audioMuted: false,
          audioSolo: false,
          items: [
            {
              id: 'vclip1',
              kind: 'clip',
              source: { path: 'video1.mp4' },
              timelineRange: { startUs: 0, durationUs: 1000 },
              sourceRange: { startUs: 0, durationUs: 1000 },
            },
          ],
        },
        {
          id: 'v2',
          kind: 'video',
          videoHidden: false,
          audioMuted: false,
          audioSolo: true,
          items: [
            {
              id: 'vclip2',
              kind: 'clip',
              source: { path: 'video2.mp4' },
              timelineRange: { startUs: 0, durationUs: 1000 },
              sourceRange: { startUs: 0, durationUs: 1000 },
            },
          ],
        },
      ],
    } as any;

    const { workerAudioClips } = useMonitorTimeline();
    const ids = workerAudioClips.value.map((c: any) => c.id);
    expect(ids).toContain('vclip2__audio');
    expect(ids).not.toContain('vclip1__audio');
  });
});
