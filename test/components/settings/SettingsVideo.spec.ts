import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';

import { mountSuspended } from '@nuxt/test-utils/runtime';
import SettingsVideo from '~/components/settings/SettingsVideo.vue';

// Mock workspace store
const mockWorkspaceStore = {
  userSettings: reactive({
    locale: 'en-US',
    openLastProjectOnStart: false,
    timeline: {
      snapThresholdPx: 8,
      defaultTransitionDurationUs: 2000000,
      defaultStaticClipDurationUs: 5000000,
      snapping: {
        timelineEdges: true,
        clips: true,
        markers: true,
        selection: true,
        playhead: true,
        playheadClick: true,
      },
      frameSnapMode: 'frames',
      toolbarSnapMode: 'snap',
      toolbarDragMode: 'pseudo_overlap',
      toolbarDragModeEnabled: false,
    },
    stopFrames: {
      qualityPercent: 85,
    },
    hotkeys: {
      layer1: 'Shift',
      layer2: 'Control',
      bindings: {},
    },
    optimization: {
      proxyMaxPixels: 1500000,
      proxyVideoBitrateMbps: 2,
      proxyAudioBitrateKbps: 128,
      proxyVideoCodec: 'h264',
      proxyCopyOpusAudio: true,
      autoCreateProxies: false,
      mediaTaskConcurrency: 2,
      pixiRenderer: 'webgl',
      videoFrameCacheMb: 256,
      nativeFrameCacheMode: 'auto',
      nativeFrameCacheCustomMb: 512,
      ffmpegPath: 'ffmpeg',
      ffprobePath: 'ffprobe',
      hardwareAccelerationMode: 'nvdec', // custom
      vaapiDevice: '/dev/dri/renderD128',
      enableHardwareEncoding: false,
      nativeMonitorSyncMode: 'balanced',
    },
    projectPresets: { custom: [], defaultTextPresetId: '', collapsed: {} },
    exportPresets: { custom: [], defaultTextPresetId: '', collapsed: {} },
    presets: {
      custom: [],
      defaultTextPresetId: '',
      collapsed: {},
    },
    projectDefaults: {
      width: 1920,
      height: 1080,
      fps: 25,
      resolutionFormat: '1080p',
      orientation: 'landscape',
      aspectRatio: '16:9',
      isCustomResolution: false,
      sampleRate: 48000,
      audioDeclickDurationUs: 5000,
      defaultAudioFadeCurve: 'logarithmic',
      audioScrubbingEnabled: true,
    },
    integrations: {
      fastcatAccount: { enabled: false, bearerToken: '' },
      fastcatPublicador: { enabled: false, bearerToken: '' },
      manualFilesApi: { enabled: false, baseUrl: '', bearerToken: '', overrideFastCat: false },
      stt: {
        provider: '',
        models: [],
        localModel: 'Xenova/whisper-tiny',
        language: '',
        restorePunctuation: true,
        formatText: false,
        includeWords: true,
      },
    },
    mouse: {
      ruler: {
        wheel: 'seek_frame',
        wheelShift: 'seek_second',
        wheelSecondary: 'scroll_horizontal',
        wheelSecondaryShift: 'zoom_horizontal',
        click: 'seek',
        middleClick: 'fit_zoom',
        doubleClick: 'add_marker',
        shiftClick: 'clear_selection',
        drag: 'move_playhead',
        middleDrag: 'pan',
        dragShift: 'select_area',
        horizontalMovement: 'none',
      },
      timeline: {
        wheel: 'scroll_vertical',
        wheelShift: 'zoom_horizontal',
        wheelSecondary: 'scroll_horizontal',
        wheelSecondaryShift: 'zoom_vertical',
        click: 'select_item',
        drag: 'move_clips',
        middleClick: 'fit_zoom',
        middleDrag: 'pan',
        horizontalMovement: 'none',
        clipDragShift: 'select_area',
        clipDragCtrl: 'free_mode',
        clipDragRight: 'copy',
      },
      trackHeaders: {
        wheel: 'scroll_vertical',
        wheelShift: 'zoom_vertical',
        wheelSecondary: 'resize_track',
        wheelSecondaryShift: 'none',
        click: 'select_track',
        middleClick: 'select_all_clips',
        doubleClick: 'select_all_clips',
      },
      monitor: {
        wheel: 'zoom',
        wheelShift: 'scroll_horizontal',
        wheelSecondary: 'scroll_horizontal',
        wheelSecondaryShift: 'scroll_vertical',
        middleClick: 'fit',
        doubleClick: 'reset_zoom_center',
        middleDrag: 'pan',
      },
    },
    deleteWithoutConfirmation: false,
    ui: { interfaceScale: 14, clipThumbnailMode: 'standard', defaultAudioWaveformMode: 'half' },
    history: { maxEntries: 100 },
    backup: { count: 5 },
    autosave: { intervalMinutes: 2 },
    experimentalFeatures: false,
    audioEngine: {
      bufferSize: 'default',
      backend: 'default',
    },
  }),
};

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

// Mock runtime
const mockIsTauriRuntime = vi.fn();
vi.mock('~/utils/runtime', () => ({
  isTauriRuntime: () => mockIsTauriRuntime(),
}));

// Mock videoDiagnostics
vi.mock('~/utils/settings/videoDiagnostics', () => ({
  gatherVideoDiagnostics: vi.fn().mockResolvedValue({
    summary: { tone: 'success', label: 'Compositor OK' },
    sections: [
      {
        title: 'Mock Browser Compositor',
        description: 'Test Browser compositor path',
        status: { tone: 'success', label: 'WebGL Ready' },
        items: [{ label: 'WebGL available', value: 'Yes' }],
      },
    ],
  }),
}));

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// Mock worker-client
vi.mock('~/utils/video-editor/worker-client', () => ({
  broadcastPixiRendererPreference: vi.fn(),
  setProxyHostApi: vi.fn(),
  getPreviewWorkerClient: () => ({
    client: { checkWebGpuSupport: vi.fn().mockResolvedValue({ supported: true }) },
  }),
}));

// Mock tauri-media-processing
const mockNativeUpdateFfmpegSettings = vi.fn().mockResolvedValue(undefined);
vi.mock('~/utils/tauri-media-processing', () => ({
  nativeUpdateFfmpegSettings: (...args: any[]) => mockNativeUpdateFfmpegSettings(...args),
}));

describe('SettingsVideo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceStore.userSettings.experimentalFeatures = false;
    mockWorkspaceStore.userSettings.optimization.hardwareAccelerationMode = 'nvdec';
    mockWorkspaceStore.userSettings.optimization.vaapiDevice = '/dev/dri/renderD128';
    mockWorkspaceStore.userSettings.optimization.enableHardwareEncoding = false;
    mockWorkspaceStore.userSettings.optimization.ffmpegPath = 'ffmpeg';
    mockWorkspaceStore.userSettings.optimization.ffprobePath = 'ffprobe';
  });

  it('renders Web settings when isTauriRuntime is false', async () => {
    mockIsTauriRuntime.mockReturnValue(false);

    const wrapper = await mountSuspended(SettingsVideo);

    // Should render pixiRenderer and videoFrameCacheMb settings
    expect(wrapper.text()).toContain('videoEditor.settings.pixiRenderer');
    expect(wrapper.text()).toContain('videoEditor.settings.videoFrameCacheMb');

    // Should NOT render ffmpeg settings
    expect(wrapper.text()).not.toContain('videoEditor.settings.video.ffmpegSettings');
    expect(wrapper.text()).not.toContain('videoEditor.settings.video.hwaccelMode');

    // Should show browser diagnostics
    expect(wrapper.text()).toContain('Mock Browser Compositor');
    expect(wrapper.text()).toContain('WebGL available');
  });

  it('renders Tauri settings and loads FFmpeg diagnostics when isTauriRuntime is true and experimentalFeatures is true', async () => {
    mockIsTauriRuntime.mockReturnValue(true);
    mockWorkspaceStore.userSettings.experimentalFeatures = true;
    vi.mocked(invoke).mockImplementation((cmd) => {
      if (cmd === 'native_get_ffmpeg_diagnostics') {
        return Promise.resolve({
          ffmpegAvailable: true,
          ffmpegVersion: 'ffmpeg version 6.0',
          ffprobeAvailable: true,
          ffprobeVersion: 'ffprobe version 6.0',
          hwaccels: ['vaapi', 'vulkan'],
          codecs: [
            {
              label: 'H.264 (AVC)',
              key: 'h264',
              decoders: [{ name: 'h264_vaapi', label: 'Hardware VAAPI', supported: true }],
              encoders: [{ name: 'h264_vaapi', label: 'Hardware VAAPI', supported: true }],
            },
          ],
        });
      }
      return Promise.resolve();
    });

    const wrapper = await mountSuspended(SettingsVideo);

    // Wait for async rendering and mounted hooks to finish
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should NOT render pixiRenderer and videoFrameCacheMb settings
    expect(wrapper.text()).not.toContain('videoEditor.settings.pixiRenderer');
    expect(wrapper.text()).not.toContain('videoEditor.settings.videoFrameCacheMb');

    // Should render ffmpeg settings
    expect(wrapper.text()).toContain('videoEditor.settings.video.ffmpegSettings');
    expect(wrapper.text()).toContain('videoEditor.settings.video.hwaccelMode');
    expect(wrapper.text()).toContain('videoEditor.settings.video.nativeFrameCacheMode');

    // Should invoke native_get_ffmpeg_diagnostics
    expect(invoke).toHaveBeenCalledWith('native_get_ffmpeg_diagnostics', expect.any(Object));

    // Should show tauri diagnostics
    expect(wrapper.text()).toContain('videoEditor.settings.video.ffmpegDiagnostics');
    expect(wrapper.text()).toContain('ffmpeg version 6.0');
    expect(wrapper.text()).toContain('ffprobe version 6.0');
    expect(wrapper.text()).toContain('vaapi, vulkan');
    expect(wrapper.text()).toContain('H.264 (AVC)');
    expect(wrapper.text()).toContain('Hardware VAAPI');
  });

  it('hides hardwareAccelerationMode and sends auto when experimentalFeatures is false', async () => {
    mockIsTauriRuntime.mockReturnValue(true);
    mockWorkspaceStore.userSettings.experimentalFeatures = false;
    mockWorkspaceStore.userSettings.optimization.enableHardwareEncoding = true;

    const wrapper = await mountSuspended(SettingsVideo);
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should not render the hwaccelMode field
    expect(wrapper.text()).not.toContain('videoEditor.settings.video.hwaccelMode');
    // Should not render the enableHardwareEncoding field
    expect(wrapper.text()).not.toContain('videoEditor.settings.video.enableHardwareEncoding');

    // Trigger watch by updating ffmpegPath
    mockWorkspaceStore.userSettings.optimization.ffmpegPath = 'ffmpeg_new';
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should sync auto and enableHardwareEncoding = false to native
    expect(mockNativeUpdateFfmpegSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        hardwareAccelerationMode: 'auto',
        enableHardwareEncoding: false,
      }),
    );
  });

  it('shows hardwareAccelerationMode and sends custom value when experimentalFeatures is true', async () => {
    mockIsTauriRuntime.mockReturnValue(true);
    mockWorkspaceStore.userSettings.experimentalFeatures = true;
    mockWorkspaceStore.userSettings.optimization.enableHardwareEncoding = true;

    const wrapper = await mountSuspended(SettingsVideo);
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should render the hwaccelMode and enableHardwareEncoding fields
    expect(wrapper.text()).toContain('videoEditor.settings.video.hwaccelMode');
    expect(wrapper.text()).toContain('videoEditor.settings.video.enableHardwareEncoding');

    // Trigger watch by updating ffmpegPath
    mockWorkspaceStore.userSettings.optimization.ffmpegPath = 'ffmpeg_new';
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should sync custom value to native
    expect(mockNativeUpdateFfmpegSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        hardwareAccelerationMode: 'nvdec',
        enableHardwareEncoding: true,
      }),
    );

    // Toggle experimentalFeatures off
    mockWorkspaceStore.userSettings.experimentalFeatures = false;
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should revert to auto and false
    expect(mockNativeUpdateFfmpegSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        hardwareAccelerationMode: 'auto',
        enableHardwareEncoding: false,
      }),
    );
  });
});
