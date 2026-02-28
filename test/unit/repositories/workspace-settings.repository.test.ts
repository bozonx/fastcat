// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createWorkspaceSettingsRepository } from '../../../src/repositories/workspace-settings.repository';

function createFileHandleMock(input: { text: string }) {
  let text = input.text;
  return {
    async getFile() {
      return {
        async text() {
          return text;
        },
      };
    },
    async createWritable() {
      return {
        async write(data: string) {
          text = data;
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
  it('returns null on missing files', async () => {
    const root = createDirMock();
    const repo = createWorkspaceSettingsRepository({ workspaceDir: root as any });

    expect(await repo.loadUserSettings()).toBeNull();
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
        audioChannels: 'stereo',
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
});
