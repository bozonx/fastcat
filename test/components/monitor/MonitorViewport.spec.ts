import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import MonitorViewport from '~/components/monitor/MonitorViewport.vue';
import { ref } from 'vue';

// Mock the composable
const mockGestures = {
  isPreviewSelected: ref(false),
  zoom: ref(1),
  zoomExact: ref(1),
  zoomLabel: ref('100%'),
  workspaceStyle: ref({ transform: 'translate(0px, 0px) scale(1)', transformOrigin: '50% 50%' }),
  resetView: vi.fn(),
  centerMonitor: vi.fn(),
  resetZoom: vi.fn(),
  fitMonitor: vi.fn(),
  onPreviewPointerDown: vi.fn(),
  onViewportPointerDown: vi.fn(),
  onViewportPointerMove: vi.fn(),
  onViewportAuxClick: vi.fn(),
  onViewportDoubleClick: vi.fn(),
  stopPan: vi.fn(),
  onViewportWheel: vi.fn(),
};

vi.mock('~/composables/monitor/useMonitorGestures', () => ({
  useMonitorGestures: () => mockGestures,
}));

describe('MonitorViewport', () => {
  it('renders slots correctly', () => {
    const wrapper = mount(MonitorViewport, {
      props: {
        renderWidth: 1920,
        renderHeight: 1080,
      },
      slots: {
        canvas: '<div id="mock-canvas"></div>',
        'svg-overlay': '<circle id="mock-overlay" />',
        default: '<div id="mock-default"></div>',
      },
    });

    expect(wrapper.find('#mock-canvas').exists()).toBe(true);
    expect(wrapper.find('#mock-overlay').exists()).toBe(true);
    expect(wrapper.find('#mock-default').exists()).toBe(true);
  });

  it('applies workspaceStyle to the inner container', () => {
    mockGestures.workspaceStyle.value = {
      transform: 'translate(10px, 20px) scale(2)',
      transformOrigin: '50% 50%',
    };

    const wrapper = mount(MonitorViewport, {
      props: {
        renderWidth: 100,
        renderHeight: 100,
      },
    });

    const transformed = wrapper.find('[style*="transform"]');
    expect(transformed.attributes('style')).toContain('transform: translate(10px, 20px) scale(2)');
  });

  it('triggers gesture handlers on interaction', async () => {
    const wrapper = mount(MonitorViewport, {
      props: {
        renderWidth: 100,
        renderHeight: 100,
      },
    });

    await wrapper.trigger('pointerdown');
    expect(mockGestures.onViewportPointerDown).toHaveBeenCalled();

    await wrapper.trigger('pointermove');
    expect(mockGestures.onViewportPointerMove).toHaveBeenCalled();

    const canvasWrapper = wrapper.find('.shrink-0');
    await canvasWrapper.trigger('pointerdown');
    expect(mockGestures.onPreviewPointerDown).toHaveBeenCalled();
  });
});
