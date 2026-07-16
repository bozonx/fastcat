import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import ClipTransitions from '~/components/timeline/ClipTransitions.vue';

describe('ClipTransitions', () => {
  const baseItem = {
    id: 'clip-1',
    kind: 'clip',
    trackId: 'track-1',
    timelineRange: { startTicks: 0, durationTicks: 10_000_000 },
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

  it('does not render create handles when no transitions are present', async () => {
    const component = await mountSuspended(ClipTransitions, {
      props: defaultProps,
    });

    const handles = component.findAll('[data-testid^="transition-create-"]');
    expect(handles).toHaveLength(0);
  });

  it('renders transition in when present', async () => {
    const component = await mountSuspended(ClipTransitions, {
      props: {
        ...defaultProps,
        clip: {
          ...baseItem,
          transitionIn: { durationTicks: 1_000_000, type: 'dissolve', mode: 'adjacent' },
        },
      },
    });

    const transitionIn = component.find('button');
    expect(transitionIn.exists()).toBe(true);

    // Check width based on timeUsToPx(1_000_000, 100)
    // Factor for 100 is roughly 141, so 1s = 1410px (actually it's calculated in geometry.ts)
    // We can just check if it's defined and has a reasonable value or use the util.
    const widthContainer = transitionIn.element.closest<HTMLElement>('[style*="width"]');
    expect(widthContainer?.style.width).toContain('px');
  });

  it('keeps transition overlays in the content band above trim handles', async () => {
    const component = await mountSuspended(ClipTransitions, {
      props: {
        ...defaultProps,
        topInsetPx: 20,
        bottomInsetPx: 10,
        clip: {
          ...baseItem,
          transitionOut: { durationTicks: 1_000_000, type: 'dissolve', mode: 'transparent' },
        },
      },
    });

    const root = component.get('.pointer-events-none');
    const transitionOut = component.get('button');
    const trigger = transitionOut.element.parentElement;

    expect(root.attributes('style')).toContain('top: 20px');
    expect(root.attributes('style')).toContain('bottom: 10px');
    expect(root.attributes('style')).toContain('z-index: calc(var(--z-clip-handles) + 1)');
    expect(trigger?.classList.contains('w-full')).toBe(true);
    expect(trigger?.classList.contains('h-full')).toBe(true);
  });

  it('emits select when transition is clicked', async () => {
    const component = await mountSuspended(ClipTransitions, {
      props: {
        ...defaultProps,
        clip: {
          ...baseItem,
          transitionIn: { durationTicks: 1_000_000, type: 'dissolve', mode: 'adjacent' },
        },
      },
    });

    const transitionIn = component.find('button');
    await transitionIn.trigger('click');
    await component.vm.$nextTick();

    expect(component.emitted('select')).toBeTruthy();
    expect(component.emitted('select')![0][1]).toEqual({
      trackId: 'track-1',
      itemId: 'clip-1',
      edge: 'in',
    });
  });

  it('highlights selected transition', async () => {
    const component = await mountSuspended(ClipTransitions, {
      props: {
        ...defaultProps,
        clip: {
          ...baseItem,
          transitionIn: { durationTicks: 1_000_000, type: 'dissolve', mode: 'adjacent' },
        },
        selectedTransition: { trackId: 'track-1', itemId: 'clip-1', edge: 'in' },
      },
    });

    const transitionIn = component.find('button');
    expect(transitionIn.classes()).toContain('ring-2');
  });
});
