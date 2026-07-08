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

    const handles = component.findAll('[data-testid^="transition-create-"]');
    expect(handles.length).toBe(2);
    expect(handles[0].attributes('style')).toContain('width:');
    expect(handles[0].attributes('style')).toContain('height:');
    expect(handles[0].attributes('style')).toContain('left:');
    expect(handles[1].attributes('style')).toContain('right:');
  });

  it('expands transition create handle hit area on hover', async () => {
    const component = await mountSuspended(ClipTransitions, {
      props: defaultProps,
    });

    const handle = component.find('[data-testid="transition-create-in"]');
    const initialStyle = handle.attributes('style') ?? '';
    await handle.trigger('pointerenter');
    const hoverStyle = handle.attributes('style') ?? '';

    expect(hoverStyle).not.toBe(initialStyle);
    expect(hoverStyle).toContain('width:');
  });

  it('shows transition create handles when the clip hover state is active', async () => {
    const component = await mountSuspended(ClipTransitions, {
      props: defaultProps,
    });

    const handle = component.get('[data-testid="transition-create-in"]');
    expect(handle.classes()).toContain('opacity-0');

    await component.setProps({ isClipHovered: true });

    expect(handle.classes()).toContain('opacity-100');
  });

  it('hides transition create handles on short tracks', async () => {
    const component = await mountSuspended(ClipTransitions, {
      props: {
        ...defaultProps,
        trackHeight: 20,
      },
    });

    const handles = component.findAll('[data-testid^="transition-create-"]');
    expect(handles.length).toBe(2);
    expect(handles.every((handle) => handle.classes().includes('hidden'))).toBe(true);
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
          transitionOut: { durationUs: 1_000_000, type: 'dissolve', mode: 'transparent' },
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

  it('positions transition create handles 20 percent above the content band bottom', async () => {
    const component = await mountSuspended(ClipTransitions, {
      props: {
        ...defaultProps,
        trackHeight: 100,
        topInsetPx: 20,
        bottomInsetPx: 10,
      },
    });

    const handle = component.get('[data-testid="transition-create-in"]');

    expect(handle.attributes('style')).toContain('bottom: 14px');
    expect(handle.attributes('style')).toContain('z-index: calc(var(--z-clip-handles) + 1)');
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
    await component.vm.$nextTick();

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

    const handle = component.find('[data-testid="transition-create-in"]');
    expect(handle.exists()).toBe(true);

    await handle.trigger('pointerdown', { clientX: 100, clientY: 100, button: 0 });

    // Find and call pointerup listener manually
    const pointerUpCall = addEventListenerSpy.mock.calls.filter((c) => c[0] === 'pointerup').at(-1);
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

  it('emits createTransition with drag start position when handle is dragged', async () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    const component = await mountSuspended(ClipTransitions, {
      props: defaultProps,
    });

    const handle = component.find('[data-testid="transition-create-in"]');
    await handle.trigger('pointerdown', { clientX: 100, clientY: 100, button: 0 });

    const pointerMoveCall = addEventListenerSpy.mock.calls
      .filter((call) => call[0] === 'pointermove')
      .at(-1);
    expect(pointerMoveCall).toBeTruthy();

    const listener = pointerMoveCall![1] as any;
    listener(new (window as any).PointerEvent('pointermove', { clientX: 114, clientY: 100 }));

    expect(component.emitted('createTransition')).toBeTruthy();
    expect(component.emitted('createTransition')![0][1]).toEqual({
      edge: 'in',
      drag: true,
      pointerStartClientX: 100,
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
