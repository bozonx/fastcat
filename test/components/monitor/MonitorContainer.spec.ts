import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import MonitorContainer from '~/components/monitor/MonitorContainer.vue';
import { ref } from 'vue';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';

// Mock all the monitor-related composables used in MonitorContainer
vi.mock('~/composables/monitor/useMonitorRuntime', () => ({
  useMonitorRuntime: () => ({
    selectionStore: {},
    videoItems: ref([]),
    safeDurationUs: ref(1000000),
    isTextClipSelected: ref(false),
    containerEl: ref(null),
    renderWidth: ref(1920),
    renderHeight: ref(1080),
    viewportRef: ref(null),
    isLoading: ref(false),
    loadError: ref(null),
    previewEffectsEnabled: ref(true),
    scheduleBuild: vi.fn(),
    useProxyInMonitor: ref(false),
    isSavingStopFrame: ref(false),
    createStopFrameSnapshot: vi.fn(),
    timecodeEl: ref(null),
    uiCurrentTimeUs: ref(0),
  }),
}));

vi.mock('~/composables/monitor/useMonitorContainerControls', () => ({
  useMonitorContainerControls: () => ({
    canInteractPlayback: ref(true),
    centerMonitor: vi.fn(),
    contextMenuItems: [],
    createMarkerAtPlayhead: vi.fn(),
    handleSpeedWheel: vi.fn(),
    onPlaybackSpeedChange: vi.fn(),
    playbackSpeedOptions: [{ label: '1x', value: 1 }],
    negativeSpeedOptions: [{ label: '-1x', value: -1 }],
    previewResolutions: ref([{ label: '1080p', value: 1080 }]),
    resetZoom: vi.fn(),
    rewindToStart: vi.fn(),
    selectedPlaybackSpeedOption: ref({ label: '1x', value: 1 }),
    setPlayback: vi.fn(),
    togglePreviewEffects: vi.fn(),
    toggleProxyUsage: vi.fn(),
    toolbarPosition: ref('bottom'),
  }),
}));

vi.mock('~/composables/monitor/useMonitorGrid', () => ({
  useMonitorGrid: () => ({
    showGrid: ref(false),
    toggleGrid: vi.fn(),
    getGridLines: vi.fn(() => []),
  }),
}));

// Mock browser APIs
const mockEnterFullscreen = vi.fn();
const mockExitFullscreen = vi.fn();
vi.mock('@vueuse/core', async () => {
  const actual = await vi.importActual('@vueuse/core');
  return {
    ...actual,
    useFullscreen: () => ({
      isFullscreen: ref(false),
      enter: mockEnterFullscreen,
      exit: mockExitFullscreen,
    }),
  };
});

describe('MonitorContainer', () => {
  let pinia: any;

  beforeEach(() => {
    pinia = createTestingPinia({
      createSpy: vi.fn,
      stubActions: false,
      initialState: {
        project: {
          activeMonitor: { zoom: 1, panX: 0, panY: 0, previewResolution: 1080 },
          projectSettings: {
            project: { width: 1920, height: 1080, fps: 30 },
            export: { width: 1920, height: 1080 },
          },
          currentView: 'cut',
        },
        timeline: {
          isPlaying: false,
          currentTime: 0,
          playbackSpeed: 1,
        },
        workspace: {
          userSettings: JSON.parse(JSON.stringify(DEFAULT_USER_SETTINGS)),
        },
        focus: {
          activePanel: 'monitor',
        },
      },
    });
  });

  it('renders viewport and toolbar', async () => {
    const wrapper = mount(MonitorContainer, {
      global: {
        plugins: [pinia],
        stubs: {
          MonitorViewport: {
            template:
              '<div class="viewport-stub"><slot name="canvas" /><slot name="svg-overlay" /><slot /></div>',
          },
          MonitorAudioControl: true,
          UiTooltip: { template: '<div><slot /></div>' },
          UButton: { template: '<button @click="$emit(\'click\', $event)"><slot /></button>' },
          UDropdownMenu: true,
          UContextMenu: true,
          UiSelect: true,
          UiCompactSelect: true,
          UiActionButton: {
            template:
              '<button class="action-btn-stub" @click="$emit(\'click\', $event)"><slot /></button>',
          },
          UiToggleButton: true,
          UiContextMenuPortal: true,
          UIcon: true,
        },
      },
    });

    await wrapper.vm.$nextTick();

    expect(wrapper.find('.viewport-stub').exists()).toBe(true);
    // Use class or more general selector if aria-label fails
    expect(wrapper.find('.action-btn-stub').exists()).toBe(true);
  });

  it('enters fullscreen on button click', async () => {
    const wrapper = mount(MonitorContainer, {
      global: {
        plugins: [pinia],
        stubs: {
          MonitorViewport: true,
          MonitorAudioControl: true,
          UiTooltip: { template: '<div><slot /></div>' },
          UButton: true,
          UiActionButton: {
            template:
              '<button class="fullscreen-btn" @click="$emit(\'click\', $event)"><slot /></button>',
          },
          UiToggleButton: true,
          UDropdownMenu: true,
          UContextMenu: true,
          UiSelect: true,
          UiCompactSelect: true,
          UiContextMenuPortal: true,
          UIcon: true,
        },
      },
    });

    await wrapper.vm.$nextTick();

    const fullscreenBtn = wrapper.find('.fullscreen-btn');
    if (!fullscreenBtn.exists()) {
      console.log('HTML:', wrapper.html());
    }
    await fullscreenBtn.trigger('click');
    expect(mockEnterFullscreen).toHaveBeenCalled();
  });
});
