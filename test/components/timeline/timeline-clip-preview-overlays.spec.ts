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
          deltaClass: '',
        },
        trimOverlay: null,
      },
    });

    expect(component.find('[data-slip-source-range]').exists()).toBe(false);
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
        },
      },
    });

    expect(component.find('[data-trim-source-range]').exists()).toBe(false);
  });

  it('renders both overlays when both are provided', async () => {
    const component = await mountSuspended(TimelineClipPreviewOverlays, {
      props: {
        slipOverlay: {
          rangeStyle: {},
          direction: '→',
          timecode: '01:00',
          hasSourceRange: false,
          deltaClass: '',
        },
        trimOverlay: {
          rangeStyle: {},
          direction: '←',
          timecode: '02:00',
          hasSourceRange: false,
        },
      },
    });

    expect(component.find('[data-slip-overlay]').exists()).toBe(true);
    expect(component.find('[data-trim-overlay]').exists()).toBe(true);
  });
});
