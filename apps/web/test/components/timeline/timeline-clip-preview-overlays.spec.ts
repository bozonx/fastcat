import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import TimelineClipPreviewOverlays from '~/components/timeline/TimelineClipPreviewOverlays.vue';

describe('TimelineClipPreviewOverlays', () => {
  it('renders nothing when both overlays are null', async () => {
    const component = await mountSuspended(TimelineClipPreviewOverlays, {
      props: { slipOverlay: null, trimOverlay: null },
    });

    expect(component.find('[data-slip-overlay]').exists()).toBe(false);
    expect(component.find('[data-trim-overlay]').exists()).toBe(false);
  });

  it('renders slip overlay when provided', async () => {
    const component = await mountSuspended(TimelineClipPreviewOverlays, {
      props: {
        slipOverlay: {
          rangeStyle: { left: '10%', width: '50%' },
          direction: '→',
          timecode: '00:01:23:10',
          hasSourceRange: true,
          showSourceRange: true,
          deltaClass: 'text-cyan-300',
        },
        trimOverlay: null,
      },
    });

    expect(component.find('[data-slip-overlay]').exists()).toBe(true);
    expect(component.find('[data-slip-source-range]').exists()).toBe(true);
    expect(component.find('[data-slip-timecode]').exists()).toBe(true);
    expect(component.text()).toContain('00:01:23:10');
  });

  it('renders trim overlay when provided', async () => {
    const component = await mountSuspended(TimelineClipPreviewOverlays, {
      props: {
        slipOverlay: null,
        trimOverlay: {
          rangeStyle: { left: '20%', width: '60%' },
          direction: '←',
          timecode: '00:00:05:00',
          hasSourceRange: true,
          showSourceRange: true,
        },
      },
    });

    expect(component.find('[data-trim-overlay]').exists()).toBe(true);
    expect(component.find('[data-trim-source-range]').exists()).toBe(true);
    expect(component.find('[data-trim-timecode]').exists()).toBe(true);
    expect(component.text()).toContain('00:00:05:00');
  });

  it('renders fallback fill when hasSourceRange is false for slip', async () => {
    const component = await mountSuspended(TimelineClipPreviewOverlays, {
      props: {
        slipOverlay: {
          rangeStyle: {},
          direction: '',
          timecode: '00:00:00:01',
          hasSourceRange: false,
          showSourceRange: true,
          deltaClass: '',
        },
        trimOverlay: null,
      },
    });

    expect(component.find('[data-slip-source-range]').exists()).toBe(false);
    // Full fallback fill is drawn instead of the range segment.
    expect(component.find('.bg-cyan-300\\/85').exists()).toBe(true);
  });

  it('renders fallback fill when hasSourceRange is false for trim', async () => {
    const component = await mountSuspended(TimelineClipPreviewOverlays, {
      props: {
        slipOverlay: null,
        trimOverlay: {
          rangeStyle: {},
          direction: '',
          timecode: '00:00:00:02',
          hasSourceRange: false,
          showSourceRange: true,
        },
      },
    });

    expect(component.find('[data-trim-source-range]').exists()).toBe(false);
    expect(component.find('.bg-amber-300\\/85').exists()).toBe(true);
  });

  // Images and virtual clips have no finite source: only the offset timecode is
  // shown while trimming/slipping — the material line and end caps are suppressed.
  it('shows only the offset (no material line) when showSourceRange is false for trim', async () => {
    const component = await mountSuspended(TimelineClipPreviewOverlays, {
      props: {
        slipOverlay: null,
        trimOverlay: {
          rangeStyle: { left: '20%', width: '60%' },
          direction: '←',
          timecode: '00:00:03:00',
          hasSourceRange: true,
          showSourceRange: false,
        },
      },
    });

    // Offset overlay + timecode still render.
    expect(component.find('[data-trim-overlay]').exists()).toBe(true);
    expect(component.find('[data-trim-timecode]').exists()).toBe(true);
    expect(component.text()).toContain('00:00:03:00');
    // Material line, its fallback fill and the end caps are all gone.
    expect(component.find('[data-trim-source-range]').exists()).toBe(false);
    expect(component.find('.bg-amber-300\\/85').exists()).toBe(false);
    expect(component.find('.bg-amber-200\\/80').exists()).toBe(false);
  });

  it('shows only the offset (no material line) when showSourceRange is false for slip', async () => {
    const component = await mountSuspended(TimelineClipPreviewOverlays, {
      props: {
        slipOverlay: {
          rangeStyle: { left: '20%', width: '60%' },
          direction: '→',
          timecode: '00:00:04:00',
          hasSourceRange: true,
          showSourceRange: false,
          deltaClass: '',
        },
        trimOverlay: null,
      },
    });

    expect(component.find('[data-slip-overlay]').exists()).toBe(true);
    expect(component.find('[data-slip-timecode]').exists()).toBe(true);
    expect(component.text()).toContain('00:00:04:00');
    expect(component.find('[data-slip-source-range]').exists()).toBe(false);
    expect(component.find('.bg-cyan-300\\/85').exists()).toBe(false);
    expect(component.find('.bg-cyan-200\\/80').exists()).toBe(false);
  });

  it('renders both overlays when both are provided', async () => {
    const component = await mountSuspended(TimelineClipPreviewOverlays, {
      props: {
        slipOverlay: {
          rangeStyle: {},
          direction: '→',
          timecode: '01:00',
          hasSourceRange: false,
          showSourceRange: true,
          deltaClass: '',
        },
        trimOverlay: {
          rangeStyle: {},
          direction: '←',
          timecode: '02:00',
          hasSourceRange: false,
          showSourceRange: true,
        },
      },
    });

    expect(component.find('[data-slip-overlay]').exists()).toBe(true);
    expect(component.find('[data-trim-overlay]').exists()).toBe(true);
  });
});
