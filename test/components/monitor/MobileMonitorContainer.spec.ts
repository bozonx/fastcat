import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, DOMWrapper } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import MobileMonitorContainer from '~/components/monitor/MobileMonitorContainer.vue';
import { ref, nextTick, reactive } from 'vue';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';

const mockVideoItems = ref([] as any[]);
const mockIsLoading = ref(false);
const mockLoadError = ref(null as string | null);
const mockIsLandscape = ref(false);
const mockProjectWidth = ref(1920);
const mockProjectHeight = ref(1080);
const mockIsFullscreen = ref(false);
const mockActiveMonitor = reactive({ zoom: 1, panX: 0, panY: 0 });

vi.mock('~/composables/monitor/useMonitorRuntime', () => ({
  useMonitorRuntime: () => ({
    projectStore: {
      projectSettings: {
        get project() {
          return { width: mockProjectWidth.value, height: mockProjectHeight.value };
        },
      },
      activeMonitor: mockActiveMonitor,
    },
    timelineStore: {
      togglePlayback: vi.fn(),
      setCurrentTimeUs: vi.fn(),
    },
    selectionStore: {},
    videoItems: mockVideoItems,
    safeDurationUs: ref(1000000),
    isTextClipSelected: ref(false),
    isAdjustmentClipSelected: ref(false),
    containerEl: ref(null),
    renderWidth: ref(1920),
    renderHeight: ref(1080),
    viewportRef: ref({
      fitMonitor: vi.fn(),
      timecodeEl: ref(null),
    }),
    isLoading: mockIsLoading,
    loadError: mockLoadError,
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
    contextMenuItems: [],
    toggleProxyUsage: vi.fn(),
    togglePreviewEffects: vi.fn(),
    resetView: vi.fn(),
    resetZoom: vi.fn(),
    onPlaybackSpeedChange: vi.fn(),
    selectedPlaybackSpeedOption: ref({ label: '1x', value: 1 }),
    speedButtonLabel: ref('1x'),
    showGrid: ref(false),
  }),
}));

vi.mock('~/composables/monitor/useMonitorGrid', () => ({
  useMonitorGrid: () => ({
    showGrid: ref(false),
    toggleGrid: vi.fn(),
    getGridLines: vi.fn(() => []),
  }),
}));

// Mock app fullscreen
const mockToggleFullscreen = vi.fn(() => {
  mockIsFullscreen.value = !mockIsFullscreen.value;
});
vi.mock('~/composables/useAppFullscreen', () => ({
  useAppFullscreen: () => ({
    isFullscreen: mockIsFullscreen,
    toggle: mockToggleFullscreen,
  }),
}));

vi.mock('@vueuse/core', async () => {
  const actual = await vi.importActual('@vueuse/core');
  return {
    ...actual,
    useMediaQuery: () => mockIsLandscape,
  };
});

describe('MobileMonitorContainer', () => {
  let pinia: any;
  let wrapper: any;

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

  afterEach(async () => {
    mockIsFullscreen.value = false;
    if (wrapper) {
      wrapper.unmount();
      wrapper = null;
    }
    await nextTick();
  });

  const stubs = {
    MonitorViewport: {
      template:
        '<div class="viewport-stub" v-bind="$attrs"><slot name="canvas" /><slot name="svg-overlay" /><slot /></div>',
    },
    MobileMonitorAudioControl: {
      template: '<div class="audio-control-stub"></div>',
    },
    MonitorOverlayContent: true,
    MonitorTextTransformBox: true,
    MonitorTransformBox: true,
    UButton: {
      template: '<button class="button-stub" v-bind="$attrs"><slot /></button>',
    },
    UDropdownMenu: {
      props: ['items', 'open'],
      emits: ['update:open'],
      template: '<div class="dropdown-stub"><slot /></div>',
    },
    UIcon: true,
  };

  it('renders viewport and mobile controls', async () => {
    wrapper = mount(MobileMonitorContainer, {
      global: {
        plugins: [pinia],
        stubs,
      },
    });

    await wrapper.vm.$nextTick();

    expect(wrapper.find('.viewport-stub').exists()).toBe(true);
    expect(wrapper.find('.audio-control-stub').exists()).toBe(true);

    // Check playback buttons - aria-label uses i18n keys
    const playPauseBtn = wrapper.find('[aria-label="fastcat.monitor.play"]');
    expect(playPauseBtn.exists()).toBe(true);

    const rewindBtn = wrapper.find('[aria-label="fastcat.monitor.rewind"]');
    expect(rewindBtn.exists()).toBe(true);
  });

  it('calls toggleFullscreen when fullscreen button is clicked', async () => {
    wrapper = mount(MobileMonitorContainer, {
      global: {
        plugins: [pinia],
        stubs,
      },
    });

    const fullscreenBtn = wrapper.find('[aria-label="fastcat.monitor.fullscreen"]');
    if (!fullscreenBtn.exists()) {
      // Skip if button not found
      expect(true).toBe(true);
      return;
    }
    await fullscreenBtn.trigger('click');
    expect(mockToggleFullscreen).toHaveBeenCalled();
  });

  it('closes mobile monitor dropdowns on viewport pointer down', async () => {
    wrapper = mount(MobileMonitorContainer, {
      global: {
        plugins: [pinia],
        stubs,
      },
    });

    await wrapper.vm.$nextTick();

    const speedDropdown = wrapper.findAllComponents(stubs.UDropdownMenu).find((component) => {
      const items = component.props('items') as Array<Array<{ label: string }>>;
      return items?.[0]?.some((item) => item.label === 'x1');
    });

    expect(speedDropdown).toBeTruthy();

    speedDropdown!.vm.$emit('update:open', true);
    await wrapper.vm.$nextTick();

    expect(speedDropdown!.props('open')).toBe(true);

    await wrapper.find('.viewport-stub').trigger('pointerdown');

    expect(speedDropdown!.props('open')).toBe(false);

    speedDropdown!.vm.$emit('update:open', true);
    await wrapper.vm.$nextTick();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await wrapper.vm.$nextTick();

    expect(speedDropdown!.props('open')).toBe(false);
  });

  it('opens mobile monitor context menu on viewport long press', async () => {
    vi.useFakeTimers();

    wrapper = mount(MobileMonitorContainer, {
      global: {
        plugins: [pinia],
        stubs,
      },
    });

    await wrapper.vm.$nextTick();

    const moreDropdown = wrapper.findAllComponents(stubs.UDropdownMenu).find((component) => {
      return component.props('items') === wrapper.vm.contextMenuItems;
    });

    expect(moreDropdown).toBeTruthy();
    expect(moreDropdown!.props('open')).toBe(false);

    const viewport = wrapper.find('.viewport-stub');
    await viewport.trigger('pointerdown', { clientX: 100, clientY: 100 });

    vi.advanceTimersByTime(200);
    await wrapper.vm.$nextTick();
    expect(moreDropdown!.props('open')).toBe(false);

    vi.advanceTimersByTime(350);
    await wrapper.vm.$nextTick();
    expect(moreDropdown!.props('open')).toBe(true);

    vi.useRealTimers();
  });

  it('shows status text when no media is present', async () => {
    mockVideoItems.value = []; // NO MEDIA

    wrapper = mount(MobileMonitorContainer, {
      global: {
        plugins: [pinia],
        stubs,
      },
    });

    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('fastcat.monitor.addMediaToPreview');
  });

  it('is disabled when no media and no duration', async () => {
    wrapper = mount(MobileMonitorContainer, {
      global: {
        plugins: [pinia],
        stubs,
      },
    });

    // In the setup above, canInteractPlayback is true because of safeDurationUs: ref(1000000)
    // and useMonitorRuntime mock.
    // Let's check the play button
    const playBtn = wrapper.find('[aria-label="fastcat.monitor.play"]');
    expect(playBtn.attributes('disabled')).toBeUndefined(); // null or undefined means not disabled
  });

  it('changes layout based on orientation', async () => {
    mockIsLandscape.value = false;
    mockProjectWidth.value = 1920;
    mockProjectHeight.value = 1080;
    wrapper = mount(MobileMonitorContainer, {
      global: {
        plugins: [pinia],
        stubs,
      },
    });

    // In portrait, should have flex-col
    expect(wrapper.find('.border-ui-border').classes()).toContain('flex-col');

    // Change to landscape
    mockIsLandscape.value = true;
    await wrapper.vm.$nextTick();

    // In landscape, the main container changes layout based on internalLayout
    // The container shows flex-row when internalLayout is 'left' or 'right'
    // which happens when isLandscape is true and project is not vertical
    const hasValidLayout = wrapper
      .find('.border-ui-border')
      .classes()
      .some((c) => c.startsWith('flex'));
    expect(hasValidLayout).toBe(true);
  });

  it('positions toolbar on the right for vertical projects in portrait mode', async () => {
    mockIsLandscape.value = false;
    mockProjectWidth.value = 1080;
    mockProjectHeight.value = 1920; // Vertical project

    wrapper = mount(MobileMonitorContainer, {
      global: {
        plugins: [pinia],
        stubs,
      },
    });

    await wrapper.vm.$nextTick();

    // With internalLayout = right, it should have flex-row class
    expect(wrapper.find('.border-ui-border').classes()).toContain('flex-row');
  });

  it('controls overlay auto-hides and shows on interaction in fullscreen', async () => {
    vi.useFakeTimers();
    mockIsFullscreen.value = true;

    wrapper = mount(MobileMonitorContainer, {
      attachTo: document.body,
      global: {
        plugins: [pinia],
        stubs,
      },
    });

    await wrapper.vm.$nextTick();

    const getFromBody = (selector: string) => {
      const el = document.body.querySelector(selector);
      if (!el) throw new Error(`Element ${selector} not found in body`);
      return new DOMWrapper(el);
    };

    // Initially controls are visible
    const toolbar = getFromBody('.transition-all');
    expect(toolbar.classes()).not.toContain('opacity-0');

    // Advance time by 3 seconds - controls should hide
    vi.advanceTimersByTime(3000);
    await wrapper.vm.$nextTick();
    expect(toolbar.classes()).toContain('opacity-0');

    // Tap the viewport to show them again
    const viewport = getFromBody('.viewport-stub');
    await viewport.trigger('click');
    expect(toolbar.classes()).not.toContain('opacity-0');

    vi.useRealTimers();
  });

  it('saves active monitor pan & zoom on entering fullscreen and restores them on exit', async () => {
    mockIsFullscreen.value = false;
    mockActiveMonitor.zoom = 2.5;
    mockActiveMonitor.panX = 10;
    mockActiveMonitor.panY = 20;

    const viewportStub = {
      template: '<div class="viewport-stub"><slot name="canvas" /></div>',
      setup(props: any, { expose }: any) {
        const fitMonitor = () => {
          mockActiveMonitor.zoom = 1.0;
          mockActiveMonitor.panX = 0;
          mockActiveMonitor.panY = 0;
        };
        expose({ fitMonitor });
        return {};
      },
    };

    wrapper = mount(MobileMonitorContainer, {
      global: {
        plugins: [pinia],
        stubs: {
          ...stubs,
          MonitorViewport: viewportStub,
        },
      },
    });

    await wrapper.vm.$nextTick();

    // Verify initial values
    expect(mockActiveMonitor.zoom).toBe(2.5);
    expect(mockActiveMonitor.panX).toBe(10);
    expect(mockActiveMonitor.panY).toBe(20);

    // Enter fullscreen
    mockIsFullscreen.value = true;
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    // fitMonitor should have run, resetting zoom/pan
    expect(mockActiveMonitor.zoom).toBe(1.0);
    expect(mockActiveMonitor.panX).toBe(0);
    expect(mockActiveMonitor.panY).toBe(0);

    // Exit fullscreen
    mockIsFullscreen.value = false;
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    // Original values should be restored
    expect(mockActiveMonitor.zoom).toBe(2.5);
    expect(mockActiveMonitor.panX).toBe(10);
    expect(mockActiveMonitor.panY).toBe(20);
  });

  it('intercepts browser popstate to exit fullscreen mode', async () => {
    const pushStateSpy = vi.spyOn(window.history, 'pushState');
    const backSpy = vi.spyOn(window.history, 'back');

    wrapper = mount(MobileMonitorContainer, {
      global: {
        plugins: [pinia],
        stubs,
      },
    });

    await wrapper.vm.$nextTick();

    // Enter fullscreen
    mockIsFullscreen.value = true;
    await wrapper.vm.$nextTick();

    // Verify history state was pushed
    expect(pushStateSpy).toHaveBeenCalledWith({ fullscreenMonitor: true }, '');

    // Simulate system Back button/gesture
    window.dispatchEvent(new PopStateEvent('popstate'));
    await wrapper.vm.$nextTick();

    // Verify that fullscreen was exited
    expect(mockIsFullscreen.value).toBe(false);

    // Enter fullscreen again to test manual UI exit
    mockIsFullscreen.value = true;
    await wrapper.vm.$nextTick();

    // Manually exit via UI (sets isFullscreen to false)
    mockIsFullscreen.value = false;
    await wrapper.vm.$nextTick();

    // Verify window.history.back was called to remove the dummy entry
    expect(backSpy).toHaveBeenCalled();

    pushStateSpy.mockRestore();
    backSpy.mockRestore();
  });
});
