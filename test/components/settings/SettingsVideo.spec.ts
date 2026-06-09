import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import SettingsVideo from '~/components/settings/SettingsVideo.vue';
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
}));

describe('SettingsVideo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceStore.userSettings = reactive(JSON.parse(JSON.stringify(DEFAULT_USER_SETTINGS)));
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

  it('renders Tauri settings and loads FFmpeg diagnostics when isTauriRuntime is true', async () => {
    mockIsTauriRuntime.mockReturnValue(true);
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
});
