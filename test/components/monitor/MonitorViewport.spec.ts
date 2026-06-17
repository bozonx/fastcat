import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import MonitorViewport from '~/components/monitor/MonitorViewport.vue';
import { ref } from 'vue';

const mockShowTimecode = ref(true);
const mockShowTransparencyGrid = ref(false);
const mockSelectionRange = ref<{ startUs: number; endUs: number } | null>(null);
const mockFps = ref(30);
const mockTimelineFormat = ref<{ fps: number } | null>(null);

vi.mock('~/composables/monitor/useMonitorSettings', () => ({
  useMonitorSettings: () => ({
    showTimecode: mockShowTimecode,
    showTransparencyGrid: mockShowTransparencyGrid,
  }),
}));

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => ({}),
}));

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => ({
    markers: [],
    get selectionRange() {
      return mockSelectionRange.value;
    },
    get fps() {
      return mockFps.value;
    },
    get timelineFormat() {
      return mockTimelineFormat.value;
    },
  }),
}));

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
  beforeEach(() => {
    mockShowTimecode.value = true;
    mockShowTransparencyGrid.value = false;
    mockSelectionRange.value = null;
    mockFps.value = 30;
    mockTimelineFormat.value = null;
  });

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

  it('applies idle class when isIdle is true in fullscreen', () => {
    const wrapper = mount(MonitorViewport, {
      props: {
        renderWidth: 100,
        renderHeight: 100,
        effectiveFullscreen: true,
        isIdle: true,
      },
    });

    expect(wrapper.find('.opacity-0').exists()).toBe(true);
  });

  it('applies fullscreen offset classes', () => {
    const wrapper = mount(MonitorViewport, {
      props: {
        renderWidth: 100,
        renderHeight: 100,
        effectiveFullscreen: true,
      },
    });

    expect(wrapper.find('.bottom-24').exists()).toBe(true);
  });

  it('triggers aux click and double click handlers', async () => {
    const wrapper = mount(MonitorViewport, {
      props: {
        renderWidth: 100,
        renderHeight: 100,
      },
    });

    await wrapper.trigger('auxclick');
    expect(mockGestures.onViewportAuxClick).toHaveBeenCalled();

    await wrapper.trigger('dblclick');
    expect(mockGestures.onViewportDoubleClick).toHaveBeenCalled();
  });

  it('applies checkerboard-bg class when showTransparencyGrid is true', () => {
    mockShowTransparencyGrid.value = true;

    const wrapper = mount(MonitorViewport, {
      props: {
        renderWidth: 100,
        renderHeight: 100,
      },
    });

    const canvasWrapper = wrapper.find('.shrink-0');
    expect(canvasWrapper.classes()).toContain('checkerboard-bg');
  });

  it('does not apply checkerboard-bg class when showTransparencyGrid is false', () => {
    const wrapper = mount(MonitorViewport, {
      props: {
        renderWidth: 100,
        renderHeight: 100,
      },
    });

    const canvasWrapper = wrapper.find('.shrink-0');
    expect(canvasWrapper.classes()).not.toContain('checkerboard-bg');
  });

  it('renders selection range and duration when selectionRange is active', () => {
    mockSelectionRange.value = { startUs: 1_000_000, endUs: 4_000_000 };
    mockFps.value = 30;

    const wrapper = mount(MonitorViewport, {
      props: {
        renderWidth: 100,
        renderHeight: 100,
      },
    });

    const overlay = wrapper.find('.text-blue-400');
    expect(overlay.exists()).toBe(true);
    expect(overlay.text()).toContain('00:00:01:00');
    expect(overlay.text()).toContain('00:00:04:00');

    const duration = wrapper.find('.text-ui-text-muted');
    expect(duration.exists()).toBe(true);
    expect(duration.text()).toBe('00:00:03:00');
  });

  it('keeps timecode element in DOM when showTimecode is toggled', async () => {
    const wrapper = mount(MonitorViewport, {
      props: {
        renderWidth: 100,
        renderHeight: 100,
      },
    });

    const timecodeSpan = wrapper.find('span.min-h-7');
    expect(timecodeSpan.exists()).toBe(true);
    expect((timecodeSpan.element as HTMLElement).style.display).not.toBe('none');

    mockShowTimecode.value = false;
    await wrapper.vm.$nextTick();
    expect(timecodeSpan.exists()).toBe(true);
    expect((timecodeSpan.element as HTMLElement).style.display).toBe('none');

    mockShowTimecode.value = true;
    await wrapper.vm.$nextTick();
    expect(timecodeSpan.exists()).toBe(true);
    expect((timecodeSpan.element as HTMLElement).style.display).not.toBe('none');
  });
});
