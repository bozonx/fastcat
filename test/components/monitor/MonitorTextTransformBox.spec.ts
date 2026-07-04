import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import MonitorTextTransformBox from '~/components/monitor/MonitorTextTransformBox.vue';
import { ref } from 'vue';

// Mock canvas 2d context for textMetrics calculation in jsdom environment
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    font: '',
    measureText: vi.fn().mockReturnValue({ width: 100 }),
  }) as any;
}

const rawWorkerTimelineClips = ref([
  {
    id: 'text-clip-1',
    clipType: 'text',
    text: 'Sample Title',
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1, linked: true },
      rotationDeg: 0,
      anchor: { preset: 'center', x: 0.5, y: 0.5 },
    },
    style: {
      fontSize: 64,
      fillColor: '#ffffff',
    },
  },
]);

vi.mock('~/composables/monitor/useMonitorTimeline', () => ({
  useMonitorTimeline: () => ({
    rawWorkerTimelineClips,
  }),
}));

describe('MonitorTextTransformBox', () => {
  let pinia: any;

  beforeEach(() => {
    rawWorkerTimelineClips.value[0] = {
      id: 'text-clip-1',
      clipType: 'text',
      text: 'Sample Title',
      transform: {
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1, linked: true },
        rotationDeg: 0,
        anchor: { preset: 'center', x: 0.5, y: 0.5 },
      },
      style: {
        fontSize: 64,
        fillColor: '#ffffff',
      },
    };

    pinia = createTestingPinia({
      createSpy: vi.fn,
      stubActions: false,
      initialState: {
        selection: {
          selectedEntity: { kind: 'clip', itemId: 'text-clip-1', trackId: 'track-1' },
        },
        workspace: {
          userSettings: {
            hotkeys: {},
          },
        },
      },
    });
  });

  it('renders bounding box and handles for selected text clip', () => {
    const wrapper = mount(MonitorTextTransformBox, {
      props: {
        renderWidth: 1920,
        renderHeight: 1080,
      },
      global: {
        plugins: [pinia],
      },
    });

    // Check main bounding rect
    const rect = wrapper.find('rect');
    expect(rect.exists()).toBe(true);

    // In text mode, handles and font size control exist
    const rects = wrapper.findAll('rect');
    expect(rects.length).toBeGreaterThanOrEqual(3);

    const circle = wrapper.find('circle');
    expect(circle.exists()).toBe(true);
    expect(circle.attributes('cursor')).toBe('ns-resize');
  });

  it('does not render when selected item is not a text clip', () => {
    rawWorkerTimelineClips.value[0] = {
      id: 'text-clip-1',
      clipType: 'media',
    } as any;

    const wrapper = mount(MonitorTextTransformBox, {
      props: {
        renderWidth: 1920,
        renderHeight: 1080,
      },
      global: {
        plugins: [pinia],
      },
    });

    expect(wrapper.find('rect').exists()).toBe(false);
  });
});
