import { describe, expect, it, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import TimelineRulerOverlays from '~/components/timeline/TimelineRulerOverlays.vue';

// Stub UContextMenu since it's not relevant to this test
vi.mock('~/components/ui/UContextMenu.vue', () => ({
  default: { template: '<div class="context-menu-stub"><slot /></div>' },
}));

describe('TimelineRulerOverlays', () => {
  const defaultProps = {
    markerPoints: [
      {
        id: 'marker-1',
        x: 100,
        width: 0,
        isZone: false,
        text: 'Marker 1',
        color: '#ff0000',
      },
      {
        id: 'marker-2',
        x: 200,
        width: 50,
        isZone: true,
        text: 'Zone Marker 2',
        color: '',
      },
    ],
    selectionRangePoint: null,
    selectionRangeMenuItems: [],
    getZoneMarkerMenuItems: () => [],
    getMarkerMenuItems: () => [],
    isMarkerSelected: (id: string) => id === 'marker-1', // marker-1 is selected, marker-2 is not
    isSelectionRangeSelected: false,
    truncateTooltip: (text: string) => text,
    selectionStartHandleLabel: 'start',
    selectionEndHandleLabel: 'end',
    markerLabel: 'marker',
    zoneMarkerStartLabel: 'zone-start',
    zoneMarkerEndLabel: 'zone-end',
    isMobile: false,
  };

  it('applies the correct outline classes for selected colored markers', async () => {
    const wrapper = await mountSuspended(TimelineRulerOverlays, {
      props: defaultProps,
      global: {
        stubs: {
          UContextMenu: {
            template: '<div class="context-menu-stub"><slot /></div>',
          },
          UiTooltip: {
            template: '<div class="tooltip-stub"><slot /></div>',
          },
        },
      },
    });

    // Find the button for marker-1 (selected colored marker)
    const marker1Btn = wrapper.find('button[aria-label="marker"]');
    expect(marker1Btn.exists()).toBe(true);

    // It should have the correct outline classes
    const classes = marker1Btn.classes();
    expect(classes).toContain('outline-2');
    expect(classes).toContain('-outline-offset-2');
    expect(classes).toContain('outline-white');
    expect(classes).toContain('focus:outline-2');
    expect(classes).toContain('focus:-outline-offset-2');
    expect(classes).toContain('focus:outline-white');
  });

  it('applies the default classes for unselected markers', async () => {
    const wrapper = await mountSuspended(TimelineRulerOverlays, {
      props: defaultProps,
      global: {
        stubs: {
          UContextMenu: {
            template: '<div class="context-menu-stub"><slot /></div>',
          },
          UiTooltip: {
            template: '<div class="tooltip-stub"><slot /></div>',
          },
        },
      },
    });

    // Find the button for marker-2 (unselected, no color -> default bg-primary-500)
    // For zone marker, there should be start and end buttons.
    // Let's check the start handle:
    const zoneStartBtn = wrapper.find('button[aria-label="zone-start"]');
    expect(zoneStartBtn.exists()).toBe(true);

    // It should have bg-primary-500 class and no outline classes
    const startClasses = zoneStartBtn.classes();
    expect(startClasses).toContain('bg-primary-500');
    expect(startClasses).not.toContain('outline-2');
    expect(startClasses).not.toContain('-outline-offset-2');
  });
});
