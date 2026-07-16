import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { ref } from 'vue';
import type { TimelineClipItem } from '~/timeline/types';
import TimelineClipKeyframeLane from '~/components/timeline/TimelineClipKeyframeLane.vue';

const keyframeTimesRef = ref<number[]>([]);
const addKeyframeAtLocalMock = vi.fn();
const moveKeyframeMomentAtMock = vi.fn();
const deleteKeyframeMomentAtMock = vi.fn();
const setKeyframeMomentEasingAtMock = vi.fn();

vi.mock('~/composables/timeline/useClipKeyframes', () => ({
  useClipKeyframes: () => ({
    keyframeTimes: keyframeTimesRef,
    addKeyframeAtLocal: addKeyframeAtLocalMock,
    moveKeyframeMomentAt: moveKeyframeMomentAtMock,
    deleteKeyframeMomentAt: deleteKeyframeMomentAtMock,
    setKeyframeMomentEasingAt: setKeyframeMomentEasingAtMock,
  }),
}));

vi.mock('~/utils/timeline/geometry', () => ({
  pxToDeltaTicks: (px: number) => px * 1000,
  timeUsToPx: (us: number) => us / 1000,
}));

vi.mock('~/timeline/animation/evaluate', () => ({
  KEYFRAME_EASINGS: ['linear', 'ease-in', 'ease-out'],
}));

vi.mock('~/timeline/animation/ops', () => ({
  animatedParamPaths: (animations: unknown) => {
    if (!animations) return [];
    return Object.keys(animations as Record<string, unknown>);
  },
}));

function createClip(animations?: any): TimelineClipItem {
  return {
    kind: 'clip',
    clipType: 'media',
    id: 'clip-1',
    trackId: 'track-1',
    name: 'Clip',
    timelineRange: { startTicks: 0, durationTicks: 5_000_000 },
    sourceRange: { startTicks: 0, durationTicks: 5_000_000 },
    animations,
  } as TimelineClipItem;
}

function mountLane(clip: TimelineClipItem) {
  return mountSuspended(TimelineClipKeyframeLane, {
    props: { clip, trackId: 'track-1', zoom: 10 },
    global: {
      provide: {
        timelineContext: {
          currentTime: ref(0),
          updateClipProperties: vi.fn(),
          setCurrentTimeTicks: vi.fn(),
        },
      },
    },
  });
}

describe('TimelineClipKeyframeLane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    keyframeTimesRef.value = [];
  });

  it('renders lane without diamonds when no keyframes', async () => {
    const component = await mountLane(createClip());
    expect(component.findAll('button').length).toBe(0);
  });

  it('renders one diamond per keyframe time', async () => {
    keyframeTimesRef.value = [1_000_000, 2_000_000];
    const component = await mountLane(
      createClip({
        opacity: {
          keyframes: [
            { tTicks: 1_000_000, easing: 'linear' },
            { tTicks: 2_000_000, easing: 'ease-in' },
          ],
        },
      } as any),
    );
    expect(component.findAll('button').length).toBe(2);
  });

  it('does not call addKeyframeAtLocal when clicking lane with no animated params', async () => {
    const component = await mountLane(createClip());
    const lane = component.find('.relative');
    await lane.trigger('click');

    expect(addKeyframeAtLocalMock).not.toHaveBeenCalled();
  });

  it('calls addKeyframeAtLocal when clicking lane background with animated params', async () => {
    const clip = createClip({ opacity: { keyframes: [] } } as any);
    const component = await mountLane(clip);

    const lane = component.find('.relative');
    const el = lane.element as HTMLElement;
    // getBoundingClientRect is used inside onLaneClick; ensure it returns a rect.
    el.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 100,
        bottom: 100,
        width: 100,
        height: 100,
        x: 0,
        y: 0,
        toJSON: () => {},
      }) as DOMRect;
    // Dispatch a native click so e.target === e.currentTarget is the lane element.
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 50, clientY: 10 }));

    expect(addKeyframeAtLocalMock).toHaveBeenCalled();
  });

  it('ignores click when target is not currentTarget (a diamond)', async () => {
    const clip = createClip({ opacity: { keyframes: [] } } as any);
    const component = await mountLane(clip);

    const lane = component.find('.relative');
    const el = lane.element as HTMLElement;
    el.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 100,
        bottom: 100,
        width: 100,
        height: 100,
        x: 0,
        y: 0,
        toJSON: () => {},
      }) as DOMRect;
    // Dispatch from a child element so target !== currentTarget.
    const child = document.createElement('div');
    el.appendChild(child);
    child.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 50, clientY: 10 }));

    expect(addKeyframeAtLocalMock).not.toHaveBeenCalled();
  });

  it('calls deleteKeyframeMomentAt on diamond double-click', async () => {
    keyframeTimesRef.value = [1_000_000];
    const clip = createClip({
      opacity: { keyframes: [{ tTicks: 1_000_000, easing: 'linear' }] },
    } as any);
    const component = await mountLane(clip);

    const diamond = component.find('button');
    await diamond.trigger('dblclick');

    expect(deleteKeyframeMomentAtMock).toHaveBeenCalledWith(1_000_000);
  });

  it('calls setKeyframeMomentEasingAt on diamond context-menu', async () => {
    keyframeTimesRef.value = [1_000_000];
    const clip = createClip({
      opacity: { keyframes: [{ tTicks: 1_000_000, easing: 'linear' }] },
    } as any);
    const component = await mountLane(clip);

    const diamond = component.find('button');
    await diamond.trigger('contextmenu');

    expect(setKeyframeMomentEasingAtMock).toHaveBeenCalledWith(1_000_000, expect.any(String));
  });

  it('positions diamonds via diamondLeftPx style', async () => {
    keyframeTimesRef.value = [1_000_000];
    const clip = createClip({
      opacity: { keyframes: [{ tTicks: 1_000_000, easing: 'linear' }] },
    } as any);
    const component = await mountLane(clip);

    const diamond = component.find('button');
    const style = diamond.attributes('style') ?? '';
    // timeUsToPx(1_000_000) = 1000px → left: 1000px
    expect(style).toContain('left: 1000px');
  });
});
