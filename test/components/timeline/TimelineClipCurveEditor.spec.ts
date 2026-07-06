import { computed } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import TimelineClipCurveEditor from '~/components/timeline/TimelineClipCurveEditor.vue';

const clip = {
  id: 'clip-1',
  kind: 'clip',
  trackId: 'track-1',
  clipType: 'media',
  name: 'Clip',
  timelineRange: { startUs: 0, durationUs: 1000 },
  sourceRange: { startUs: 0, durationUs: 1000 },
  animations: {
    opacity: {
      keyframes: [
        { tUs: 0, value: 0, easing: 'linear' },
        { tUs: 1000, value: 1, easing: 'linear' },
      ],
    },
    'transform.rotationDeg': {
      keyframes: [{ tUs: 0, value: 45, easing: 'linear' }],
    },
  },
};

describe('TimelineClipCurveEditor', () => {
  it('cycles easing on the selected path keyframe only', async () => {
    const updateClipProperties = vi.fn();
    const wrapper = await mountSuspended(TimelineClipCurveEditor, {
      props: {
        clip: clip as any,
        trackId: 'track-1',
        zoom: 1,
      },
      global: {
        provide: {
          timelineContext: {
            currentTime: computed(() => 0),
            updateClipProperties,
          },
        },
      },
    });

    const circles = wrapper.findAll('circle');
    expect(circles.length).toBeGreaterThan(0);
    await circles[0]!.trigger('click');

    expect(updateClipProperties).toHaveBeenCalledWith('track-1', 'clip-1', {
      animations: {
        opacity: {
          keyframes: [
            { tUs: 0, value: 0, easing: 'ease' },
            { tUs: 1000, value: 1, easing: 'linear' },
          ],
        },
        'transform.rotationDeg': {
          keyframes: [{ tUs: 0, value: 45, easing: 'linear' }],
        },
      },
    });
  });
});
