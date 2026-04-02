/** @vitest-environment node */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useMonitorTimeline } from '~/composables/monitor/useMonitorTimeline';
import { useTimelineStore } from '~/stores/timeline.store';
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createTestingPinia } from '@pinia/testing';

describe('useMonitorTimeline', () => {
  let pinia: any;

  beforeEach(() => {
    pinia = createTestingPinia({
      createSpy: vi.fn,
      stubActions: false,
    });
  });

  function withMonitorTimeline(
    fn: (res: ReturnType<typeof useMonitorTimeline>, store: any) => void,
  ) {
    const TestComp = defineComponent({
      setup() {
        const store = useTimelineStore();
        const res = useMonitorTimeline();
        fn(res, store);
        return () => h('div');
      },
    });
    mount(TestComp, { global: { plugins: [pinia] } });
  }

  it('provides monitor timeline clip collections', () => {
    withMonitorTimeline((res, timelineStore) => {
      timelineStore.timelineDoc = {
        tracks: [
          {
            id: '1',
            kind: 'audio',
            items: [
              {
                id: 'audio1',
                kind: 'clip',
                clipType: 'media',
                source: { path: 'test.mp3' },
                timelineRange: { startUs: 0, durationUs: 1000 },
                sourceRange: { startUs: 0, durationUs: 1000 },
              },
            ],
          },
          {
            id: '2',
            kind: 'video',
            videoHidden: false,
            items: [
              {
                id: 'item1',
                kind: 'clip',
                clipType: 'media',
                source: { path: 'test.mp4' },
                timelineRange: { startUs: 0, durationUs: 1000 },
                sourceRange: { startUs: 0, durationUs: 1000 },
              },
            ],
          },
        ],
      } as any;

      const { videoItems, rawWorkerAudioClips } = res;
      expect(videoItems.value.length).toBe(1);
      expect(videoItems.value[0].id).toBe('item1');

      expect(rawWorkerAudioClips.value.length).toBe(2);
      expect(rawWorkerAudioClips.value.map((clip) => clip.id)).toEqual(['audio1', 'item1__audio']);
      expect(rawWorkerAudioClips.value.every((clip: any) => clip.clipType === 'media')).toBe(true);
    });
  });

  it('computes workerTimelineClips and workerAudioClips correctly', () => {
    withMonitorTimeline((res, timelineStore) => {
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
                clipType: 'media',
                trackId: '2',
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
                clipType: 'media',
                trackId: '1',
                source: { path: 'test1.mp3' },
                timelineRange: { startUs: 0, durationUs: 1000 },
                sourceRange: { startUs: 0, durationUs: 1000 },
              },
            ],
          },
        ],
      } as any;

      const { rawWorkerTimelineClips, rawWorkerAudioClips } = res;
      expect(rawWorkerTimelineClips.value.length).toBe(1);
      expect(rawWorkerTimelineClips.value[0].id).toBe('item1');
      expect(rawWorkerTimelineClips.value[0].clipType).toBe('media');
      expect(rawWorkerTimelineClips.value[0].source?.path).toBe('test1.mp4');
      expect(rawWorkerTimelineClips.value[0].timelineRange.startUs).toBe(0);
      expect(rawWorkerTimelineClips.value[0].layer).toBe(0);

      expect(rawWorkerAudioClips.value.length).toBe(2);
      expect(rawWorkerAudioClips.value.find((x: any) => x.id === 'audio1')?.source?.path).toBe(
        'test1.mp3',
      );
      expect(rawWorkerAudioClips.value.find((x: any) => x.id === 'audio1')?.trackId).toBe('1');
      expect(
        rawWorkerAudioClips.value.find((x: any) => x.id === 'item1__audio')?.source?.path,
      ).toBe('test1.mp4');
      expect(rawWorkerAudioClips.value.find((x: any) => x.id === 'item1__audio')?.trackId).toBe(
        '2',
      );
    });
  });

  it('assigns inverted layers so first track (top in UI) renders on top', () => {
    withMonitorTimeline((res, timelineStore) => {
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

      const { rawWorkerTimelineClips } = res;
      const clip1 = rawWorkerTimelineClips.value.find((c: any) => c.id === 'clip1');
      const clip2 = rawWorkerTimelineClips.value.find((c: any) => c.id === 'clip2');

      expect(clip1?.layer).toBe(1);
      expect(clip2?.layer).toBe(0);
    });
  });

  it('keeps raw worker video clip compositing separate from top-level track compositing', () => {
    withMonitorTimeline((res, timelineStore) => {
      timelineStore.timelineDoc = {
        tracks: [
          {
            id: 'v1',
            kind: 'video',
            videoHidden: false,
            opacity: 0.25,
            blendMode: 'screen',
            effects: [{ id: 'track-effect', type: 'blur', enabled: true, amount: 5 }],
            items: [
              {
                id: 'clip1',
                kind: 'clip',
                clipType: 'media',
                trackId: 'v1',
                source: { path: 'a.mp4' },
                opacity: 0.5,
                blendMode: 'multiply',
                effects: [{ id: 'clip-effect', type: 'blur', enabled: true, amount: 1 }],
                timelineRange: { startUs: 0, durationUs: 1000 },
                sourceRange: { startUs: 0, durationUs: 1000 },
              },
            ],
          },
        ],
      } as any;

      const { rawWorkerTimelineClips } = res;
      expect(rawWorkerTimelineClips.value).toHaveLength(1);
      expect(rawWorkerTimelineClips.value[0]).toMatchObject({
        id: 'clip1',
        trackId: 'v1',
        opacity: 0.5,
        blendMode: 'multiply',
      });
      expect(rawWorkerTimelineClips.value[0]?.effects).toEqual([
        { id: 'clip-effect', type: 'blur', enabled: true, amount: 1 },
      ]);
    });
  });

  it('normalizes background clip color in raw worker timeline clips', () => {
    withMonitorTimeline((res, timelineStore) => {
      timelineStore.timelineDoc = {
        tracks: [
          {
            id: 'v1',
            kind: 'video',
            videoHidden: false,
            items: [
              {
                id: 'bg1',
                kind: 'clip',
                clipType: 'background',
                trackId: 'v1',
                backgroundColor: 'abc',
                timelineRange: { startUs: 0, durationUs: 1000 },
                sourceRange: { startUs: 0, durationUs: 1000 },
              },
            ],
          },
        ],
      } as any;

      expect(res.rawWorkerTimelineClips.value).toHaveLength(1);
      expect(res.rawWorkerTimelineClips.value[0]).toMatchObject({
        clipType: 'background',
        backgroundColor: '#aabbcc',
      });
    });
  });

  it('preserves multiple adjustment clips in raw worker timeline clips', () => {
    withMonitorTimeline((res, timelineStore) => {
      timelineStore.timelineDoc = {
        tracks: [
          {
            id: 'v1',
            kind: 'video',
            videoHidden: false,
            items: [
              {
                id: 'adj1',
                kind: 'clip',
                clipType: 'adjustment',
                trackId: 'v1',
                effects: [{ id: 'fx1', type: 'blur', enabled: true, amount: 2 }],
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
                id: 'adj2',
                kind: 'clip',
                clipType: 'adjustment',
                trackId: 'v2',
                effects: [{ id: 'fx2', type: 'color-adjustment', enabled: true, brightness: 1 }],
                timelineRange: { startUs: 0, durationUs: 1000 },
                sourceRange: { startUs: 0, durationUs: 1000 },
              },
            ],
          },
        ],
      } as any;

      expect(
        res.rawWorkerTimelineClips.value.filter((clip: any) => clip.clipType === 'adjustment'),
      ).toHaveLength(2);
    });
  });

  it('mirrors adjacent transitionOut onto the next background clip in monitor payload', () => {
    withMonitorTimeline((res, timelineStore) => {
      timelineStore.timelineDoc = {
        tracks: [
          {
            id: 'v1',
            kind: 'video',
            videoHidden: false,
            items: [
              {
                id: 'adj1',
                kind: 'clip',
                clipType: 'adjustment',
                trackId: 'v1',
                transitionOut: {
                  type: 'dissolve',
                  durationUs: 500,
                  mode: 'adjacent',
                  curve: 'linear',
                  params: {},
                },
                timelineRange: { startUs: 0, durationUs: 1000 },
                sourceRange: { startUs: 0, durationUs: 1000 },
              },
              {
                id: 'bg1',
                kind: 'clip',
                clipType: 'background',
                trackId: 'v1',
                backgroundColor: '#112233',
                timelineRange: { startUs: 1000, durationUs: 1000 },
                sourceRange: { startUs: 0, durationUs: 1000 },
              },
            ],
          },
        ],
      } as any;

      const background = res.rawWorkerTimelineClips.value.find((clip: any) => clip.id === 'bg1');
      expect(background).toMatchObject({
        clipType: 'background',
        transitionIn: {
          type: 'dissolve',
          durationUs: 500,
          mode: 'adjacent',
        },
      });
    });
  });

  it('workerAudioClips does not duplicate audio from video clips', () => {
    withMonitorTimeline((res, timelineStore) => {
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
        ],
      } as any;

      expect(res.rawWorkerAudioClips.value.length).toBe(1);
      expect(
        res.rawWorkerAudioClips.value.find((c: any) => c.id === 'vclip1__audio'),
      ).toBeDefined();
      expect(
        res.rawWorkerAudioClips.value.find((c: any) => c.id === 'vclip2__audio'),
      ).toBeUndefined();
    });
  });

  it('computes signatures correctly', () => {
    withMonitorTimeline((res, timelineStore) => {
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
        ],
      } as any;

      const { clipSourceSignature, clipLayoutSignature } = res;

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

  it('updates clip layout signature when clip or track blendMode changes', () => {
    withMonitorTimeline((res, timelineStore) => {
      timelineStore.timelineDoc = {
        tracks: [
          {
            id: 'v1',
            kind: 'video',
            videoHidden: false,
            opacity: 1,
            blendMode: 'normal',
            items: [
              {
                id: 'clip1',
                kind: 'clip',
                clipType: 'media',
                trackId: 'v1',
                source: { path: 'a.mp4' },
                opacity: 1,
                blendMode: 'normal',
                timelineRange: { startUs: 0, durationUs: 1000 },
                sourceRange: { startUs: 0, durationUs: 1000 },
              },
            ],
          },
        ],
      } as any;

      const { clipSourceSignature, clipLayoutSignature } = res;
      const sourceBeforeClipBlend = clipSourceSignature.value;
      const layoutBeforeClipBlend = clipLayoutSignature.value;

      timelineStore.timelineDoc.tracks[0].items[0].blendMode = 'screen';

      expect(clipSourceSignature.value).toBe(sourceBeforeClipBlend);
      expect(clipLayoutSignature.value).not.toBe(layoutBeforeClipBlend);

      const layoutBeforeTrackBlend = clipLayoutSignature.value;
      timelineStore.timelineDoc.tracks[0].blendMode = 'multiply';

      expect(clipLayoutSignature.value).not.toBe(layoutBeforeTrackBlend);
    });
  });

  it('applies video track solo/mute to __audio clips extracted from video', () => {
    withMonitorTimeline((res, timelineStore) => {
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

      const ids = res.rawWorkerAudioClips.value.map((c: any) => c.id);
      expect(ids).toContain('vclip2__audio');
      expect(ids).not.toContain('vclip1__audio');
    });
  });

  it('filters hidden video tracks from workerTimelineClips', () => {
    withMonitorTimeline((res, timelineStore) => {
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

      expect(res.workerTimelineClips.value.length).toBe(0);
    });
  });

  it('applies audio solo/mute when building workerAudioClips', () => {
    withMonitorTimeline((res, timelineStore) => {
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

      expect(res.rawWorkerAudioClips.value.length).toBe(1);
      expect(res.rawWorkerAudioClips.value[0].id).toBe('aclip2');
    });
  });
});
