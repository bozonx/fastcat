// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceSettingsRepository } from '~/repositories/workspace-settings.repository';
import { isTauriRuntime } from '~/utils/runtime';

const tauriFsState = vi.hoisted(() => ({
  files: new Map<string, string>(),
}));

vi.mock('~/utils/runtime', () => ({
  isTauriRuntime: vi.fn(() => false),
}));

vi.mock('@tauri-apps/api/path', () => ({
  appConfigDir: vi.fn().mockResolvedValue('/mock-config'),
  appDataDir: vi.fn().mockResolvedValue('/mock-data'),
  appCacheDir: vi.fn().mockResolvedValue('/mock-cache'),
  tempDir: vi.fn().mockResolvedValue('/mock-temp'),
  documentDir: vi.fn().mockResolvedValue('/mock-documents'),
  isAbsolute: vi.fn().mockResolvedValue(false),
  resourceDir: vi.fn().mockResolvedValue('/mock-resource'),
  resolve: vi.fn().mockImplementation(async (path: string) => `/absolute/${path}`),
  join: vi.fn().mockImplementation(async (...parts: string[]) => parts.join('/')),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  exists: vi.fn().mockImplementation(async (path: string) => tauriFsState.files.has(path)),
  readTextFile: vi.fn().mockImplementation(async (path: string) => tauriFsState.files.get(path)),
  writeTextFile: vi.fn().mockImplementation(async (path: string, text: string) => {
    tauriFsState.files.set(path, text);
  }),
}));

function createFileHandleMock(input: { text: string }) {
  let bytes = new TextEncoder().encode(input.text);

  return {
    async getFile() {
      return {
        async text() {
          return new TextDecoder().decode(bytes);
        },
      };
    },
    async createWritable() {
      return {
        // The repository writes JSON in chunks: a `{ type: 'write', position, data }`
        // payload per chunk followed by a `truncate`. Accept both shapes.
        async write(data: string | { type: 'write'; position?: number; data: Uint8Array }) {
          if (typeof data === 'string') {
            bytes = new TextEncoder().encode(data);
            return;
          }
          const position = data.position ?? bytes.length;
          const nextLength = Math.max(bytes.length, position + data.data.length);
          const nextBytes = new Uint8Array(nextLength);
          nextBytes.set(bytes);
          nextBytes.set(data.data, position);
          bytes = nextBytes;
        },
        async truncate(size: number) {
          bytes = bytes.slice(0, size);
        },
        async close() {
          // no-op
        },
      };
    },
  };
}

function createDirMock() {
  const files = new Map<string, any>();
  const dirs = new Map<string, any>();

  return {
    async getDirectoryHandle(name: string, options?: { create?: boolean }) {
      if (dirs.has(name)) return dirs.get(name);
      if (!options?.create) {
        const err: any = new Error('NotFound');
        err.name = 'NotFoundError';
        throw err;
      }
      const next = createDirMock();
      dirs.set(name, next);
      return next;
    },
    async getFileHandle(name: string, options?: { create?: boolean }) {
      if (files.has(name)) return files.get(name);
      if (!options?.create) {
        const err: any = new Error('NotFound');
        err.name = 'NotFoundError';
        throw err;
      }
      const next = createFileHandleMock({ text: '' });
      files.set(name, next);
      return next;
    },
    __debug: {
      files,
      dirs,
    },
  };
}

describe('workspace-settings.repository', () => {
  beforeEach(() => {
    vi.mocked(isTauriRuntime).mockReturnValue(false);
    tauriFsState.files.clear();
  });

  it('returns null on missing files', async () => {
    const root = createDirMock();
    const repo = createWorkspaceSettingsRepository({ workspaceDir: root as any });

    expect(await repo.loadUserSettings()).toBeNull();
    expect(await repo.loadAppSettings()).toBeNull();
    expect(await repo.loadWorkspaceSettings()).toBeNull();
  });

  it('saves and loads user settings', async () => {
    const root = createDirMock();
    const repo = createWorkspaceSettingsRepository({ workspaceDir: root as any });

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
    const root = createDirMock();
    const repo = createWorkspaceSettingsRepository({ workspaceDir: root as any });

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

    expect(tauriFsState.files.has('/mock-config/app.settings.json')).toBe(true);

    const workspaceConfigDir = root.__debug.dirs.get('.fastcat-config');
    expect(workspaceConfigDir).toBeTruthy();
    expect(workspaceConfigDir.__debug.files.has('app.settings.json')).toBe(true);

    const loadedAppSettings = await repo.loadAppSettings();
    const loadedWorkspaceSettings = await repo.loadWorkspaceSettings();

    expect((loadedAppSettings as any).storage.mode).toBe('system');
    expect((loadedWorkspaceSettings as any).projectDefaults.width).toBe(1280);
  });
});
