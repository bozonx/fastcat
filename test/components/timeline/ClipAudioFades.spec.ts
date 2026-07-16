import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { TICKS_PER_SECOND } from '~/utils/time';
import ClipAudioFades from '~/components/timeline/ClipAudioFades.vue';
import { timelineTicks } from '../../unit/utils/timeline-time';

describe('ClipAudioFades', () => {
  const baseItem = {
    id: 'clip-1',
    kind: 'clip',
    trackId: 'track-1',
    timelineRange: { startTicks: 0, durationTicks: 10 * TICKS_PER_SECOND },
    audioFadeInTicks: TICKS_PER_SECOND,
    audioFadeOutTicks: TICKS_PER_SECOND,
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
    isSelected: true,
    defaultFadeDurationTicks: 2 * TICKS_PER_SECOND,
    defaultFadeCurve: 'logarithmic' as const,
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
    // gain=1 is at 33.3% height
    expect(volumeLine.attributes('style')).toContain('top: 33.3');
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

  it('disables volume dragging when clip is not selected', async () => {
    const component = await mountSuspended(ClipAudioFades, {
      props: {
        ...defaultProps,
        isSelected: false,
      },
    });

    const volumeLine = component.get('[data-testid="clip-volume-control"]');
    expect(volumeLine.classes()).toContain('pointer-events-none');
    expect(volumeLine.classes()).not.toContain('cursor-ns-resize');
    expect(volumeLine.classes()).not.toContain('pointer-events-auto');
  });

  it('enables volume dragging when clip is selected', async () => {
    const component = await mountSuspended(ClipAudioFades, {
      props: {
        ...defaultProps,
        isSelected: true,
      },
    });

    const volumeLine = component.get('[data-testid="clip-volume-control"]');
    expect(volumeLine.classes()).toContain('cursor-ns-resize');
    expect(volumeLine.classes()).toContain('pointer-events-auto');
    expect(volumeLine.classes()).not.toContain('pointer-events-none');
  });

  it('emits startResizeFade when fade handle is dragged', async () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    const component = await mountSuspended(ClipAudioFades, {
      props: defaultProps,
    });

    const handles = [
      component.get('[data-testid="fade-handle-in"]'),
      component.get('[data-testid="fade-handle-out"]'),
    ];
    expect(handles[0].classes()).toContain('cursor-pointer');
    expect(handles[1].classes()).toContain('cursor-pointer');

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
      durationTicks: TICKS_PER_SECOND,
    });

    addEventListenerSpy.mockRestore();
  });

  it('emits toggleFadeCurve when fade handle is only clicked', async () => {
    vi.useFakeTimers();
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    const component = await mountSuspended(ClipAudioFades, {
      props: defaultProps,
    });

    await component
      .get('[data-testid="fade-handle-in"]')
      .find('div')
      .trigger('pointerdown', { clientX: 100, clientY: 100, button: 0 });

    // Find and call pointerup listener manually
    const upCall = addEventListenerSpy.mock.calls.find((c) => c[0] === 'pointerup');
    expect(upCall).toBeTruthy();
    (upCall![1] as any)(
      new (window as any).PointerEvent('pointerup', { clientX: 100, clientY: 100 }),
    );

    await vi.advanceTimersByTimeAsync(220);

    expect(component.emitted('toggleFadeCurve')).toBeTruthy();
    expect(component.emitted('toggleFadeCurve')![0][0]).toEqual({
      edge: 'in',
    });

    addEventListenerSpy.mockRestore();
    vi.useRealTimers();
  });

  it('creates a default fade on single click when the fade is empty', async () => {
    vi.useFakeTimers();
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    const component = await mountSuspended(ClipAudioFades, {
      props: {
        ...defaultProps,
        clip: { ...baseItem, audioFadeInTicks: 0 },
      },
    });

    await component
      .get('[data-testid="fade-handle-in"]')
      .find('div')
      .trigger('pointerdown', { clientX: 100, clientY: 100, button: 0 });

    const upCall = addEventListenerSpy.mock.calls.find((c) => c[0] === 'pointerup');
    expect(upCall).toBeTruthy();
    (upCall![1] as any)(
      new (window as any).PointerEvent('pointerup', { clientX: 100, clientY: 100 }),
    );

    await vi.advanceTimersByTimeAsync(220);

    expect(component.emitted('commitFade')![0][0]).toEqual({
      edge: 'in',
      durationTicks: 2 * TICKS_PER_SECOND,
      curve: 'logarithmic',
    });
    expect(component.emitted('toggleFadeCurve')).toBeUndefined();

    addEventListenerSpy.mockRestore();
    vi.useRealTimers();
  });

  it('resets an existing fade on double click without applying the pending single click', async () => {
    vi.useFakeTimers();
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    const component = await mountSuspended(ClipAudioFades, {
      props: defaultProps,
    });

    await component
      .get('[data-testid="fade-handle-in"]')
      .find('div')
      .trigger('pointerdown', { clientX: 100, clientY: 100, button: 0 });

    const upCall = addEventListenerSpy.mock.calls.find((c) => c[0] === 'pointerup');
    expect(upCall).toBeTruthy();
    (upCall![1] as any)(
      new (window as any).PointerEvent('pointerup', { clientX: 100, clientY: 100 }),
    );

    await component.get('[data-testid="fade-handle-in"]').trigger('dblclick');
    await vi.advanceTimersByTimeAsync(220);

    expect(component.emitted('commitFade')![0][0]).toEqual({
      edge: 'in',
      durationTicks: 0,
    });
    expect(component.emitted('toggleFadeCurve')).toBeUndefined();

    addEventListenerSpy.mockRestore();
    vi.useRealTimers();
  });

  it('places the fade handles layer above full-height trim handles', async () => {
    const component = await mountSuspended(ClipAudioFades, {
      props: defaultProps,
    });

    expect(component.get('[data-testid="fade-handles-layer"]').attributes('style')).toContain(
      'z-index: calc(var(--z-clip-handles) + 1)',
    );
    expect(component.get('[data-testid="fade-handle-in"]').classes()).toContain(
      'pointer-events-auto',
    );
    expect(component.get('[data-testid="fade-handle-in"]').classes()).toContain('cursor-pointer');
    expect(component.get('[data-testid="fade-handle-out"]').classes()).toContain(
      'pointer-events-auto',
    );
    expect(component.get('[data-testid="fade-handle-out"]').classes()).toContain('cursor-pointer');
  });

  // While the clip's borders are being trimmed or its material is slipped, the
  // fade drag handles must disappear (they sit under the trim handle and get in
  // the way) — but the fade shapes themselves must stay drawn.
  describe('fade handles during trim / material move', () => {
    it('shows both handles and both fade shapes at rest', async () => {
      const component = await mountSuspended(ClipAudioFades, { props: defaultProps });

      expect(component.find('[data-testid="fade-handle-in"]').exists()).toBe(true);
      expect(component.find('[data-testid="fade-handle-out"]').exists()).toBe(true);
      expect(component.find('[data-testid="fade-shape-in"]').exists()).toBe(true);
      expect(component.find('[data-testid="fade-shape-out"]').exists()).toBe(true);
    });

    it('hides the handles but keeps the fade shapes when hideFadeHandles is set', async () => {
      const component = await mountSuspended(ClipAudioFades, {
        props: { ...defaultProps, hideFadeHandles: true },
      });

      // Handles gone (covers both trimming a border and slipping material).
      expect(component.find('[data-testid="fade-handle-in"]').exists()).toBe(false);
      expect(component.find('[data-testid="fade-handle-out"]').exists()).toBe(false);
      expect(component.findAll('.cursor-ew-resize').length).toBe(0);

      // Fade shapes stay drawn.
      expect(component.find('[data-testid="fade-shape-in"]').exists()).toBe(true);
      expect(component.find('[data-testid="fade-shape-out"]').exists()).toBe(true);
    });

    it('restores the handles when the interaction ends', async () => {
      const component = await mountSuspended(ClipAudioFades, {
        props: { ...defaultProps, hideFadeHandles: true },
      });
      expect(component.find('[data-testid="fade-handle-in"]').exists()).toBe(false);

      await component.setProps({ hideFadeHandles: false });
      expect(component.find('[data-testid="fade-handle-in"]').exists()).toBe(true);
      expect(component.find('[data-testid="fade-handle-out"]').exists()).toBe(true);
    });
  });

  describe('volume control visibility', () => {
    async function mountAndGetControl(props: Record<string, unknown>) {
      const clipOverrides = (props.clip as Record<string, unknown>) ?? {};
      const component = await mountSuspended(ClipAudioFades, {
        props: {
          ...defaultProps,
          ...props,
          clip: { ...baseItem, ...clipOverrides },
        },
      });
      return component.get('[data-testid="clip-volume-control"]');
    }

    // The draggable volume bar and the % indicator share this container; its
    // opacity-0 hides both. Rule: hidden only when the clip is unselected AND
    // gain is 100% (plus the muted / active-resize guards). Shown otherwise.
    const isHidden = (el: { classes(): string[] }) => el.classes().includes('opacity-0');

    it('hides when unselected and gain is 100%', async () => {
      const el = await mountAndGetControl({
        clip: { audioGain: 1 },
        isSelected: false,
        isHovered: false,
      });
      expect(isHidden(el)).toBe(true);
    });

    it('stays hidden on hover when unselected and gain is 100% (regression)', async () => {
      // Hovering must NOT reveal the control for a default-volume, unselected clip.
      const el = await mountAndGetControl({
        clip: { audioGain: 1 },
        isSelected: false,
        isHovered: true,
      });
      expect(isHidden(el)).toBe(true);
    });

    it('shows when selected even at 100% gain', async () => {
      const el = await mountAndGetControl({
        clip: { audioGain: 1 },
        isSelected: true,
        isHovered: false,
      });
      expect(isHidden(el)).toBe(false);
    });

    it('shows when gain differs from 100% even if unselected', async () => {
      const el = await mountAndGetControl({
        clip: { audioGain: 1.5 },
        isSelected: false,
        isHovered: false,
      });
      expect(isHidden(el)).toBe(false);
    });

    it('shows while actively resizing volume', async () => {
      const el = await mountAndGetControl({
        clip: { audioGain: 1 },
        isSelected: false,
        isHovered: false,
        isResizingVolume: true,
      });
      expect(isHidden(el)).toBe(false);
    });

    it('hides when muted regardless of selection', async () => {
      const el = await mountAndGetControl({
        clip: { audioGain: 1.5, audioMuted: true },
        isSelected: true,
        isHovered: true,
      });
      expect(isHidden(el)).toBe(true);
    });
  });

  describe('volume indicator label and positioning', () => {
    it('renders label with 100% even if gain is 1.0 (100%) and selected', async () => {
      const component = await mountSuspended(ClipAudioFades, {
        props: {
          ...defaultProps,
          clip: { ...baseItem, audioGain: 1.0 },
          isSelected: true,
        },
      });

      const control = component.get('[data-testid="clip-volume-control"]');
      const label = control.find('.text-2xs');
      expect(label.exists()).toBe(true);
      expect(label.text()).toContain('100%');
    });

    it('positions label in the center when center is within viewport', async () => {
      const component = await mountSuspended(ClipAudioFades, {
        props: {
          ...defaultProps,
          clipWidthPx: 400,
          scrollLeft: 0,
          viewportWidth: 1000,
          item: {
            ...baseItem,
            timelineRange: { startTicks: timelineTicks(100_000), durationTicks: timelineTicks(4_000_000) },
          },
          clip: {
            ...baseItem,
            timelineRange: { startTicks: timelineTicks(100_000), durationTicks: timelineTicks(4_000_000) },
          },
        },
      });

      const control = component.get('[data-testid="clip-volume-control"]');
      const label = control.find('.text-2xs');
      expect(label.exists()).toBe(true);
      expect(label.attributes('style')).toContain('left: 200px');
    });

    it('shifts label to stay visible when center is outside viewport (center to the left)', async () => {
      const component = await mountSuspended(ClipAudioFades, {
        props: {
          ...defaultProps,
          clipWidthPx: 400,
          scrollLeft: 250,
          viewportWidth: 500,
          zoom: 50,
          item: { ...baseItem, timelineRange: { startTicks: 0, durationTicks: timelineTicks(4_000_000) } },
          clip: { ...baseItem, timelineRange: { startTicks: 0, durationTicks: timelineTicks(4_000_000) } },
        },
      });

      const control = component.get('[data-testid="clip-volume-control"]');
      const label = control.find('.text-2xs');
      expect(label.exists()).toBe(true);
      expect(label.attributes('style')).toContain('left: 325px');
    });

    it('hides the entire volume control when track height is less than 35px', async () => {
      const component = await mountSuspended(ClipAudioFades, {
        props: {
          ...defaultProps,
          trackHeight: 30, // less than 35px
        },
      });

      const control = component.find('[data-testid="clip-volume-control"]');
      expect(control.exists()).toBe(false);
    });

    it('hides the label when clipWidthPx is less than 48px', async () => {
      const component = await mountSuspended(ClipAudioFades, {
        props: {
          ...defaultProps,
          clipWidthPx: 40, // less than 48px
          trackHeight: 50,
        },
      });

      const control = component.get('[data-testid="clip-volume-control"]');
      const label = control.find('.text-2xs');
      expect(label.exists()).toBe(false);
    });

    it('positions label above the line when there is more space above', async () => {
      const component = await mountSuspended(ClipAudioFades, {
        props: {
          ...defaultProps,
          clip: { ...baseItem, audioGain: 0.1 }, // very low volume, line will be near the bottom
          trackHeight: 100,
        },
      });

      const control = component.get('[data-testid="clip-volume-control"]');
      const label = control.find('.text-2xs');
      expect(label.exists()).toBe(true);
      expect(label.classes()).toContain('bottom-full');
      expect(label.classes()).not.toContain('top-full');
    });

    it('positions label below the line when there is more space below', async () => {
      const component = await mountSuspended(ClipAudioFades, {
        props: {
          ...defaultProps,
          clip: { ...baseItem, audioGain: 1.0 }, // volumeY = 33.3%, line is near the top
          trackHeight: 100,
        },
      });

      const control = component.get('[data-testid="clip-volume-control"]');
      const label = control.find('.text-2xs');
      expect(label.exists()).toBe(true);
      expect(label.classes()).toContain('top-full');
      expect(label.classes()).not.toContain('bottom-full');
    });
  });
});
