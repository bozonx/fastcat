import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reactive } from 'vue';
import { invoke } from '@tauri-apps/api/core';

import { mountSuspended } from '@nuxt/test-utils/runtime';
import SettingsAudio from '~/components/settings/SettingsAudio.vue';

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
      hardwareAccelerationMode: 'none',
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
    backup: { enabled: true, count: 5 },
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

// Mock webcodecs
vi.mock('~/utils/webcodecs', () => ({
  BASE_AUDIO_CODEC_OPTIONS: [
    { value: 'aac', label: 'AAC' },
    { value: 'opus', label: 'Opus' },
  ],
  checkAudioCodecSupport: vi.fn().mockResolvedValue({
    aac: true,
    opus: false,
  }),
}));

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// Mock worker-client (in case imported somewhere)
vi.mock('~/utils/video-editor/worker-client', () => ({
  setProxyHostApi: vi.fn(),
}));

// Mock native-monitor-ipc
const mockSetAudioSettings = vi.fn();
vi.mock('~/composables/monitor/native-monitor-ipc', () => ({
  nativeMonitorIpc: {
    setAudioSettings: (...args: any[]) => mockSetAudioSettings(...args),
  },
}));

describe('SettingsAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceStore.userSettings.locale = 'en-US';
    mockWorkspaceStore.userSettings.openLastProjectOnStart = false;
    mockWorkspaceStore.userSettings.experimentalFeatures = false;
    mockWorkspaceStore.userSettings.audioEngine.bufferSize = 'default';
    mockWorkspaceStore.userSettings.audioEngine.backend = 'default';
  });

  afterEach(() => {
    delete (globalThis as any).AudioEncoder;
  });

  it('renders Web audio settings and diagnostics when isTauriRuntime is false', async () => {
    mockIsTauriRuntime.mockReturnValue(false);

    // Mock AudioEncoder on globalThis to simulate support in browser
    (globalThis as any).AudioEncoder = {
      isConfigSupported: vi.fn().mockResolvedValue({ supported: true }),
    };

    const wrapper = await mountSuspended(SettingsAudio);

    // Wait for microtasks
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should show browser diagnostics header
    expect(wrapper.text()).toContain('videoEditor.settings.audio.accelerationDiagnostics');
    expect(wrapper.text()).toContain('AudioEncoder Available');
    expect(wrapper.text()).toContain('Browser Audio Codec Support');
    expect(wrapper.text()).toContain('AAC');
    expect(wrapper.text()).toContain('Supported');
    expect(wrapper.text()).toContain('Unsupported'); // Opus is unsupported in mock
  });

  it('renders Tauri settings and loads FFmpeg diagnostics when isTauriRuntime is true', async () => {
    mockIsTauriRuntime.mockReturnValue(true);
    vi.mocked(invoke).mockImplementation((cmd) => {
      if (cmd === 'native_get_ffmpeg_diagnostics') {
        return Promise.resolve({
          ffmpegAvailable: true,
          ffmpegVersion: 'ffmpeg version 6.0',
          ffprobeAvailable: true,
          ffprobeVersion: 'ffprobe version 6.0',
          hwaccels: ['vaapi'],
          codecs: [
            {
              label: 'AAC (Advanced Audio Coding)',
              key: 'aac',
              decoders: [{ name: 'aac', label: 'AAC Decoder', supported: true }],
              encoders: [{ name: 'aac', label: 'AAC Encoder', supported: true }],
            },
            {
              label: 'Opus',
              key: 'opus',
              decoders: [{ name: 'libopus', label: 'Opus Decoder', supported: false }],
              encoders: [{ name: 'libopus', label: 'Opus Encoder', supported: true }],
            },
          ],
        });
      }
      return Promise.resolve();
    });

    const wrapper = await mountSuspended(SettingsAudio);

    // Wait for async rendering and mounted hooks to finish
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should show Tauri audio diagnostics header
    expect(wrapper.text()).toContain('videoEditor.settings.audio.tauriDiagnosticsHeader');
    expect(wrapper.text()).toContain('videoEditor.settings.audio.ffmpegDiagnostics');
    expect(wrapper.text()).toContain('ffmpeg version 6.0');
    expect(wrapper.text()).toContain('ffprobe version 6.0');

    // Should invoke native_get_ffmpeg_diagnostics
    expect(invoke).toHaveBeenCalledWith('native_get_ffmpeg_diagnostics', expect.any(Object));

    // Should show codec details
    expect(wrapper.text()).toContain('AAC (Advanced Audio Coding)');
    expect(wrapper.text()).toContain('Opus');
    expect(wrapper.text()).toContain('AAC Decoder');
  });

  it('hides native settings and sends default values when experimentalFeatures is false', async () => {
    mockIsTauriRuntime.mockReturnValue(true);
    mockWorkspaceStore.userSettings.experimentalFeatures = false;
    mockWorkspaceStore.userSettings.audioEngine.bufferSize = 'default';
    mockWorkspaceStore.userSettings.audioEngine.backend = 'default';

    const wrapper = await mountSuspended(SettingsAudio);
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Native audio settings title should not be rendered
    expect(wrapper.text()).not.toContain('videoEditor.settings.audio.nativeEngineTitle');

    // Change a setting to trigger the watch
    mockWorkspaceStore.userSettings.audioEngine.bufferSize = 512;
    await new Promise((resolve) => setTimeout(resolve, 10));

    // It should have called setAudioSettings with default values
    expect(mockSetAudioSettings).toHaveBeenLastCalledWith({
      bufferSize: 'default',
      backend: 'default',
    });
  });

  it('shows native settings and sends custom values when experimentalFeatures is true', async () => {
    mockIsTauriRuntime.mockReturnValue(true);
    mockWorkspaceStore.userSettings.experimentalFeatures = true;
    mockWorkspaceStore.userSettings.audioEngine.bufferSize = 'default';
    mockWorkspaceStore.userSettings.audioEngine.backend = 'default';

    const wrapper = await mountSuspended(SettingsAudio);
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Native audio settings title should be rendered
    expect(wrapper.text()).toContain('videoEditor.settings.audio.nativeEngineTitle');

    // Change a setting to trigger the watch
    mockWorkspaceStore.userSettings.audioEngine.bufferSize = 512;
    mockWorkspaceStore.userSettings.audioEngine.backend = 'alsa';
    await new Promise((resolve) => setTimeout(resolve, 10));

    // It should have called setAudioSettings with the user-defined values
    expect(mockSetAudioSettings).toHaveBeenLastCalledWith({
      bufferSize: 512,
      backend: 'alsa',
    });

    // If we toggle experimentalFeatures to false, it should send default values
    mockWorkspaceStore.userSettings.experimentalFeatures = false;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockSetAudioSettings).toHaveBeenLastCalledWith({
      bufferSize: 'default',
      backend: 'default',
    });
  });
});
