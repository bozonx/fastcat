import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import SettingsAudio from '~/components/settings/SettingsAudio.vue';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';

// Mock workspace store
const mockWorkspaceStore = {
  userSettings: reactive(JSON.parse(JSON.stringify(DEFAULT_USER_SETTINGS))),
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

describe('SettingsAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceStore.userSettings = reactive(JSON.parse(JSON.stringify(DEFAULT_USER_SETTINGS)));
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
});
