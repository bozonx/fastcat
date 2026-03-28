import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import ClipAudioFades from '~/components/timeline/ClipAudioFades.vue';

describe('ClipAudioFades', () => {
  const baseItem = {
    id: 'clip-1',
    kind: 'clip',
    trackId: 'track-1',
    timelineRange: { startUs: 0, durationUs: 10_000_000 },
    audioFadeInUs: 1_000_000,
    audioFadeOutUs: 1_000_000,
    audioGain: 1,
    locked: false,
  } as any;

  const baseTrack = {
    id: 'track-1',
    kind: 'audio',
    locked: false,
  } as any;

  const defaultProps = {
    clip: baseItem,
    item: baseItem,
    track: baseTrack,
    zoom: 50,
    clipWidthPx: 1000,
    canEdit: true,
    trackHeight: 100,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders fade paths correctly', async () => {
    const component = await mountSuspended(ClipAudioFades, {
      props: defaultProps,
    });

    const svgs = component.findAll('svg');
    expect(svgs.length).toBe(2); // In and Out
    // At zoom 50, factor is 1, so 10px per second. 1s = 10px.
    expect(svgs[0].attributes('style')).toContain('width: 10px');
  });

  it('renders volume control line at correct height', async () => {
    const component = await mountSuspended(ClipAudioFades, {
      props: {
        ...defaultProps,
        clip: { ...baseItem, audioGain: 1 }, // 100%
      },
    });

    const volumeLine = component.find('.cursor-ns-resize');
    // GAIN_MAX is 4, so gain=1 is at (1 - 1/4) * 100 = 75%
    expect(volumeLine.attributes('style')).toContain('top: 75%');
  });

  it('emits startResizeVolume on volume line pointerdown', async () => {
    const component = await mountSuspended(ClipAudioFades, {
      props: defaultProps,
    });

    const volumeLine = component.find('.cursor-ns-resize');
    await volumeLine.trigger('pointerdown', { clientX: 100, clientY: 100, button: 0 });

    expect(component.emitted('startResizeVolume')).toBeTruthy();
    expect(component.emitted('startResizeVolume')![0][1]).toBe(1); // gain
  });

  it('emits resetVolume on double click', async () => {
    const component = await mountSuspended(ClipAudioFades, {
      props: defaultProps,
    });

    const volumeLine = component.find('.cursor-ns-resize');
    await volumeLine.trigger('dblclick');

    expect(component.emitted('resetVolume')).toBeTruthy();
  });

  it('emits startResizeFade when fade handle is dragged', async () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    const component = await mountSuspended(ClipAudioFades, {
      props: defaultProps,
    });

    const handles = component.findAll('.cursor-ew-resize');
    expect(handles.length).toBe(2);

    // Fade In handle - trigger on the INNER circle
    const handle = handles[0].find('div');
    expect(handle.exists()).toBe(true);
    await handle.trigger('pointerdown', { clientX: 100, clientY: 100, button: 0 });

    // Find and call pointermove listener manually
    const moveCall = addEventListenerSpy.mock.calls.find((c) => c[0] === 'pointermove');
    expect(moveCall).toBeTruthy();
    (moveCall![1] as any)(
      new (window as any).PointerEvent('pointermove', { clientX: 120, clientY: 100 }),
    );

    expect(component.emitted('startResizeFade')).toBeTruthy();
    expect(component.emitted('startResizeFade')![0][1]).toEqual({
      edge: 'in',
      durationUs: 1_000_000,
    });

    addEventListenerSpy.mockRestore();
  });

  it('emits toggleFadeCurve when fade handle is only clicked', async () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    const component = await mountSuspended(ClipAudioFades, {
      props: defaultProps,
    });

    const handles = component.findAll('.cursor-ew-resize');
    await handles[0].find('div').trigger('pointerdown', { clientX: 100, clientY: 100, button: 0 });

    // Find and call pointerup listener manually
    const upCall = addEventListenerSpy.mock.calls.find((c) => c[0] === 'pointerup');
    expect(upCall).toBeTruthy();
    (upCall![1] as any)(
      new (window as any).PointerEvent('pointerup', { clientX: 100, clientY: 100 }),
    );

    expect(component.emitted('toggleFadeCurve')).toBeTruthy();
    expect(component.emitted('toggleFadeCurve')![0][0]).toEqual({
      edge: 'in',
    });

    addEventListenerSpy.mockRestore();
  });
});
