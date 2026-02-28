// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createProjectSettingsRepository } from '../../../src/repositories/project-settings.repository';

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

describe('project-settings.repository', () => {
  it('returns null on missing file', async () => {
    const projectDir = createDirMock();
    const repo = createProjectSettingsRepository({ projectDir: projectDir as any });

    expect(await repo.load()).toBeNull();
  });

  it('saves and loads project settings', async () => {
    const projectDir = createDirMock();
    const repo = createProjectSettingsRepository({ projectDir: projectDir as any });

    await repo.save({
      project: {
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
          metadata: {
            title: '',
            author: '',
            tags: '',
          },
        },
      },
      monitor: {
        previewResolution: 480,
        useProxy: true,
        panX: 0,
        panY: 0,
      },
      timelines: {
        openPaths: [],
        lastOpenedPath: null,
      },
      transitions: {
        defaultDurationUs: 2_000_000,
      },
    });

    const raw = await repo.load();
    expect(raw).toBeTruthy();
    expect((raw as any).project.width).toBe(1920);
    expect((raw as any).exportDefaults.encoding.metadata).toBeTruthy();
  });
});
