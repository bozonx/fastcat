// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceSettingsRepository } from '~/repositories/workspace-settings.repository';
import { InMemoryFileSystemAdapter } from '~/file-manager/core/vfs/adapters/InMemoryFileSystemAdapter';
import { isTauriRuntime } from '~/utils/runtime';

vi.mock('~/utils/runtime', () => ({
  isTauriRuntime: vi.fn(() => false),
}));

describe('workspace-settings.repository', () => {
  beforeEach(() => {
    vi.mocked(isTauriRuntime).mockReturnValue(false);
  });

  it('returns null on missing files', async () => {
    const repo = createWorkspaceSettingsRepository({ vfs: new InMemoryFileSystemAdapter() });

    expect(await repo.loadUserSettings()).toBeNull();
    expect(await repo.loadAppSettings()).toBeNull();
    expect(await repo.loadWorkspaceSettings()).toBeNull();
  });

  it('saves and loads user settings', async () => {
    const repo = createWorkspaceSettingsRepository({ vfs: new InMemoryFileSystemAdapter() });

    await repo.saveUserSettings({
      openLastProjectOnStart: true,
      stopFrames: { qualityPercent: 85 },
      hotkeys: { bindings: {} },
      optimization: {
        proxyResolution: '720p',
        proxyVideoBitrateMbps: 2,
        proxyAudioBitrateKbps: 128,
        proxyCopyOpusAudio: true,
        autoCreateProxies: true,
        proxyConcurrency: 2,
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
      },
      exportDefaults: {
        encoding: {
          format: 'mp4',
          videoCodec: 'avc1.640032',
          bitrateMbps: 5,
          excludeAudio: false,
          audioCodec: 'aac',
          audioBitrateKbps: 128,
          bitrateMode: 'variable',
          keyframeIntervalSec: 2,
          exportAlpha: false,
        },
      },
      mouse: {
        timeline: {
          wheel: 'scroll_vertical',
          wheelShift: 'scroll_horizontal',
          wheelSecondary: 'scroll_horizontal',
          wheelSecondaryShift: 'zoom_vertical',
          middleClick: 'pan',
        },
        monitor: {
          wheel: 'zoom',
          wheelShift: 'scroll_horizontal',
          middleClick: 'pan',
        },
      },
    });

    const loaded = await repo.loadUserSettings();
    expect(loaded).toBeTruthy();
    expect((loaded as any).openLastProjectOnStart).toBe(true);
  });

  it('keeps Tauri global app settings separate from workspace settings', async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    const vfs = new InMemoryFileSystemAdapter();
    const repo = createWorkspaceSettingsRepository({ vfs });

    await repo.saveAppSettings({
      ui: { locale: 'en-US', theme: 'dark' },
      storage: { mode: 'system' },
      integrations: {
        bloggerDog: { enabled: false },
        fastcatAccount: { enabled: false },
        stt: { enabled: false, models: [] },
      },
    } as any);
    await repo.saveWorkspaceSettings({
      projectDefaults: {
        width: 1280,
        height: 720,
        fps: 30,
        resolutionFormat: '720p',
        orientation: 'landscape',
        aspectRatio: '16:9',
        isCustomResolution: false,
        sampleRate: 48000,
      },
    } as any);

    // Global app settings → config dir; workspace settings → workspace config dir.
    expect(await vfs.exists('@config/app.settings.json')).toBe(true);
    expect(await vfs.exists('@workspace/.fastcat-config/app.settings.json')).toBe(true);

    const loadedAppSettings = await repo.loadAppSettings();
    const loadedWorkspaceSettings = await repo.loadWorkspaceSettings();

    expect((loadedAppSettings as any).storage.mode).toBe('system');
    expect((loadedWorkspaceSettings as any).projectDefaults.width).toBe(1280);
  });
});
