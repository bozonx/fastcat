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

    // Global app settings → config dir; workspace settings → /vardata.
    expect(await vfs.exists('@config/app.settings.json')).toBe(true);
    expect(await vfs.exists('/vardata/app.settings.json')).toBe(true);

    const loadedAppSettings = await repo.loadAppSettings();
    const loadedWorkspaceSettings = await repo.loadWorkspaceSettings();

    expect((loadedAppSettings as any).storage.mode).toBe('system');
    expect((loadedWorkspaceSettings as any).projectDefaults.width).toBe(1280);
  });

  describe('workspace-state', () => {
    const sampleState = {
      ui: {
        recentSearchQueries: ['cats', 'dogs'],
        pinnedItems: ['/pinned/a'],
        lastProjectName: 'demo',
        recentProjects: [
          { projectName: 'demo', projectId: '1', updatedAt: '2026-01-01', lastTimelinePath: 't.otio' },
        ],
      },
      fileBrowser: {
        instances: { editor: { viewMode: 'grid', sortOption: { field: 'name', order: 'asc' } } },
        activeTab: 'computer',
      },
    };

    it('returns null on missing file', async () => {
      const repo = createWorkspaceSettingsRepository({ vfs: new InMemoryFileSystemAdapter() });
      expect(await repo.loadWorkspaceState()).toBeNull();
    });

    it('round-trips the full WorkspaceState verbatim (no normalization at repo layer)', async () => {
      const repo = createWorkspaceSettingsRepository({ vfs: new InMemoryFileSystemAdapter() });

      await repo.saveWorkspaceState(sampleState);
      const loaded = await repo.loadWorkspaceState();

      expect(loaded).toEqual(sampleState);
    });

    it('preserves partial/empty objects literally (consumer normalizes)', async () => {
      const repo = createWorkspaceSettingsRepository({ vfs: new InMemoryFileSystemAdapter() });

      await repo.saveWorkspaceState({ ui: {}, fileBrowser: { instances: {}, activeTab: 'fastcat' } });
      const loaded = await repo.loadWorkspaceState();

      expect(loaded).toEqual({ ui: {}, fileBrowser: { instances: {}, activeTab: 'fastcat' } });
    });

    it('writes to the web workspace config dir', async () => {
      const vfs = new InMemoryFileSystemAdapter();
      const repo = createWorkspaceSettingsRepository({ vfs });

      await repo.saveWorkspaceState(sampleState);

      expect(await vfs.exists('@workspace/.fastcat-config/workspace-state.json')).toBe(true);
    });
  });

  describe('Tauri routing', () => {
    beforeEach(() => {
      vi.mocked(isTauriRuntime).mockReturnValue(true);
    });

    it('routes user settings to @config (global) and isolates from /vardata', async () => {
      const vfs = new InMemoryFileSystemAdapter();
      const repo = createWorkspaceSettingsRepository({ vfs });

      await repo.saveUserSettings({ openLastProjectOnStart: true } as any);

      expect(await vfs.exists('@config/user.settings.json')).toBe(true);
      expect(await vfs.exists('/vardata/user.settings.json')).toBe(false);

      const loaded = await repo.loadUserSettings();
      expect((loaded as any).openLastProjectOnStart).toBe(true);
    });

    it('routes workspace-state to /vardata and isolates from @config', async () => {
      const vfs = new InMemoryFileSystemAdapter();
      const repo = createWorkspaceSettingsRepository({ vfs });

      await repo.saveWorkspaceState({ ui: {}, fileBrowser: { instances: {}, activeTab: 'computer' } });

      expect(await vfs.exists('/vardata/workspace-state.json')).toBe(true);
      expect(await vfs.exists('@config/workspace-state.json')).toBe(false);
    });
  });

  describe('web routing', () => {
    it('writes each settings file to @workspace/.fastcat-config', async () => {
      const vfs = new InMemoryFileSystemAdapter();
      const repo = createWorkspaceSettingsRepository({ vfs });

      await repo.saveUserSettings({ openLastProjectOnStart: true } as any);
      await repo.saveAppSettings({ ui: { locale: 'en' } } as any);
      await repo.saveWorkspaceState({ ui: {}, fileBrowser: { instances: {}, activeTab: 'computer' } });

      expect(await vfs.exists('@workspace/.fastcat-config/user.settings.json')).toBe(true);
      expect(await vfs.exists('@workspace/.fastcat-config/app.settings.json')).toBe(true);
      expect(await vfs.exists('@workspace/.fastcat-config/workspace-state.json')).toBe(true);
    });
  });

  describe('documented web-collision behavior', () => {
    // In the browser, `loadWorkspaceSettings`/`saveWorkspaceSettings` reuse the
    // same `app.settings.json` file as `loadAppSettings`/`saveAppSettings`
    // (they differ only by `isGlobal`, which has no effect outside Tauri). So a
    // later workspace-settings write overwrites the earlier app-settings one.
    it('saveAppSettings then saveWorkspaceSettings: loadAppSettings returns the latter', async () => {
      const repo = createWorkspaceSettingsRepository({ vfs: new InMemoryFileSystemAdapter() });

      await repo.saveAppSettings({ storage: { mode: 'system' } } as any);
      await repo.saveWorkspaceSettings({ projectDefaults: { width: 1280 } } as any);

      const loaded = await repo.loadAppSettings();
      expect((loaded as any).projectDefaults.width).toBe(1280);
    });
  });

  describe('edge cases', () => {
    it('refuses to write undefined workspace-state', async () => {
      const repo = createWorkspaceSettingsRepository({ vfs: new InMemoryFileSystemAdapter() });

      await expect(repo.saveWorkspaceState(undefined as never)).rejects.toThrow();
    });

    it('idempotently overwrites user settings on repeated saves', async () => {
      const repo = createWorkspaceSettingsRepository({ vfs: new InMemoryFileSystemAdapter() });

      await repo.saveUserSettings({ openLastProjectOnStart: true } as any);
      await repo.saveUserSettings({ openLastProjectOnStart: false } as any);

      const loaded = await repo.loadUserSettings();
      expect((loaded as any).openLastProjectOnStart).toBe(false);
    });
  });
});
