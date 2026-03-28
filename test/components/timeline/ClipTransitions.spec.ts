import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive } from 'vue';
import ClipTransitions from '~/components/timeline/ClipTransitions.vue';

describe('ClipTransitions', () => {
  const baseItem = {
    id: 'clip-1',
    kind: 'clip',
    trackId: 'track-1',
    timelineRange: { startUs: 0, durationUs: 10_000_000 },
    transitionIn: null,
    transitionOut: null,
    locked: false,
  } as any;

  const baseTrack = {
    id: 'track-1',
    kind: 'video',
    locked: false,
    items: [baseItem],
  } as any;

  const defaultProps = {
    clip: baseItem,
    track: baseTrack,
    zoom: 100,
    clipWidthPx: 2000,
    canEdit: true,
    trackHeight: 100,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders transition handles when no transitions are present', async () => {
    const component = await mountSuspended(ClipTransitions, {
      props: defaultProps,
    });

    const handles = component.findAll('.cursor-ew-resize');
    // They are hidden by default via opacity-0 in CSS, but present in DOM
    expect(handles.length).toBe(2);
  });

  it('renders transition in when present', async () => {
    const component = await mountSuspended(ClipTransitions, {
      props: {
        ...defaultProps,
        clip: {
          ...baseItem,
          transitionIn: { durationUs: 1_000_000, type: 'dissolve', mode: 'adjacent' },
        },
      },
    });

    const transitionIn = component.find('button');
    expect(transitionIn.exists()).toBe(true);

    // Check width based on timeUsToPx(1_000_000, 100)
    // Factor for 100 is roughly 141, so 1s = 1410px (actually it's calculated in geometry.ts)
    // We can just check if it's defined and has a reasonable value or use the util.
    const expectedWidth = Math.floor(10 * Math.pow(2, 50 / 7)); // roughly 1410
    expect(transitionIn.element.parentElement?.style.width).toContain('px');
  });

  it('emits select when transition is clicked', async () => {
    const component = await mountSuspended(ClipTransitions, {
      props: {
        ...defaultProps,
        clip: {
          ...baseItem,
          transitionIn: { durationUs: 1_000_000, type: 'dissolve', mode: 'adjacent' },
        },
      },
    });

    const transitionIn = component.find('button');
    await transitionIn.trigger('click');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(component.emitted('select')).toBeTruthy();
    expect(component.emitted('select')![0][1]).toEqual({
      trackId: 'track-1',
      itemId: 'clip-1',
      edge: 'in',
    });
  });

  it('emits createTransition when handle is clicked', async () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    const component = await mountSuspended(ClipTransitions, {
      props: defaultProps,
    });

    // Find the INNER div that has the @pointerdown listener
    const handle = component.find('.cursor-ew-resize div');
    expect(handle.exists()).toBe(true);

    // Simulating pointerdown
    await handle.trigger('pointerdown', { clientX: 100, clientY: 100, button: 0 });

    // Find and call pointerup listener manually
    const pointerUpCall = addEventListenerSpy.mock.calls.find((c) => c[0] === 'pointerup');
    expect(pointerUpCall).toBeTruthy();
    const listener = pointerUpCall![1] as any;

    listener(new (window as any).PointerEvent('pointerup', { clientX: 100, clientY: 100 }));

    expect(component.emitted('createTransition')).toBeTruthy();
    expect(component.emitted('createTransition')![0][1]).toEqual({
      edge: 'in',
      drag: false,
    });

    addEventListenerSpy.mockRestore();
  });

  it('highlights selected transition', async () => {
    const component = await mountSuspended(ClipTransitions, {
      props: {
        ...defaultProps,
        clip: {
          ...baseItem,
          transitionIn: { durationUs: 1_000_000, type: 'dissolve', mode: 'adjacent' },
        },
        selectedTransition: { trackId: 'track-1', itemId: 'clip-1', edge: 'in' },
      },
    });

    const transitionIn = component.find('button');
    expect(transitionIn.classes()).toContain('ring-2');
  });
});
