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

  it('applies a visible SVG stroke for selected colored markers', async () => {
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

    const pinShape = marker1Btn.find('path');
    expect(pinShape.attributes('stroke')).toBe('#ffffff');
    expect(pinShape.attributes('stroke-width')).toBe('2.5');
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

    const startClasses = zoneStartBtn.classes();
    expect(startClasses).toContain('bg-primary-500');
    expect(zoneStartBtn.find('path').attributes('stroke')).toBe('transparent');
  });

  it('highlights the zone body in selected and unselected states', async () => {
    // 1. Unselected zone marker (marker-2)
    const wrapper = await mountSuspended(TimelineRulerOverlays, {
      props: defaultProps,
      global: {
        stubs: {
          UContextMenu: { template: '<div class="context-menu-stub"><slot /></div>' },
          UiTooltip: { template: '<div class="tooltip-stub"><slot /></div>' },
        },
      },
    });

    const zoneBgUnselected = wrapper.find('div[class*="pointer-events-auto"]').find('div');
    expect(zoneBgUnselected.exists()).toBe(true);
    expect(zoneBgUnselected.classes()).toContain('bg-primary-500/20');
    expect(zoneBgUnselected.classes()).toContain('border-primary-500/50');

    // 2. Selected zone marker
    const selectedProps = {
      ...defaultProps,
      isMarkerSelected: (id: string) => id === 'marker-2',
    };
    const wrapperSelected = await mountSuspended(TimelineRulerOverlays, {
      props: selectedProps,
      global: {
        stubs: {
          UContextMenu: { template: '<div class="context-menu-stub"><slot /></div>' },
          UiTooltip: { template: '<div class="tooltip-stub"><slot /></div>' },
        },
      },
    });

    const zoneBgSelected = wrapperSelected.find('div[class*="pointer-events-auto"]').find('div');
    expect(zoneBgSelected.exists()).toBe(true);
    expect(zoneBgSelected.classes()).toContain('bg-primary-500/35');
    expect(zoneBgSelected.classes()).toContain('border-primary-500');
  });
});
