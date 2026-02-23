import { describe, it, expect } from 'vitest';

interface GranVideoEditorUserSettings {
  openLastProjectOnStart: boolean;
  exportDefaults: {
    width: number;
    height: number;
    fps: number;
    resolutionFormat: string;
    orientation: 'landscape' | 'portrait';
    aspectRatio: string;
    isCustomResolution: boolean;
    encoding: {
      format: 'mp4' | 'webm' | 'mkv';
      videoCodec: string;
      bitrateMbps: number;
      excludeAudio: boolean;
      audioCodec: 'aac' | 'opus';
      audioBitrateKbps: number;
    };
  };
}

interface GranVideoEditorWorkspaceSettings {
  proxyStorageLimitBytes: number;
  cacheStorageLimitBytes: number;
  thumbnailsStorageLimitBytes: number;
}

function normalizeUserSettingsForTest(raw: unknown): GranVideoEditorUserSettings {
  const DEFAULT = {
    openLastProjectOnStart: true,
    exportDefaults: {
      width: 1920,
      height: 1080,
      fps: 25,
      resolutionFormat: '1080p',
      orientation: 'landscape' as const,
      aspectRatio: '16:9',
      isCustomResolution: false,
      encoding: {
        format: 'mp4' as const,
        videoCodec: 'avc1.640032',
        bitrateMbps: 5,
        excludeAudio: false,
        audioCodec: 'aac' as const,
        audioBitrateKbps: 128,
      },
    },
  };

  if (!raw || typeof raw !== 'object') return structuredClone(DEFAULT);

  const input = raw as Record<string, any>;
  const exportInput = input.exportDefaults ?? input.export ?? null;
  const encodingInput = exportInput?.encoding ?? {};

  const width = Number(exportInput?.width);
  const height = Number(exportInput?.height);
  const fps = Number(exportInput?.fps);
  const bitrateMbps = Number(encodingInput?.bitrateMbps);
  const audioBitrateKbps = Number(encodingInput?.audioBitrateKbps);
  const format = encodingInput?.format;

  const normalizedWidth =
    Number.isFinite(width) && width > 0 ? Math.round(width) : DEFAULT.exportDefaults.width;
  const normalizedHeight =
    Number.isFinite(height) && height > 0 ? Math.round(height) : DEFAULT.exportDefaults.height;

  const openLastProjectOnStartRaw = input.openLastProjectOnStart;
  const openBehavior = input.openBehavior;
  const openLastProjectOnStart =
    typeof openLastProjectOnStartRaw === 'boolean'
      ? openLastProjectOnStartRaw
      : openBehavior === 'show_project_picker'
        ? false
        : DEFAULT.openLastProjectOnStart;

  return {
    openLastProjectOnStart,
    exportDefaults: {
      width: normalizedWidth,
      height: normalizedHeight,
      fps:
        Number.isFinite(fps) && fps > 0
          ? Math.round(Math.min(240, Math.max(1, fps)))
          : DEFAULT.exportDefaults.fps,
      resolutionFormat: DEFAULT.exportDefaults.resolutionFormat,
      orientation: DEFAULT.exportDefaults.orientation,
      aspectRatio: DEFAULT.exportDefaults.aspectRatio,
      isCustomResolution: DEFAULT.exportDefaults.isCustomResolution,
      encoding: {
        format: format === 'webm' || format === 'mkv' ? format : 'mp4',
        videoCodec:
          typeof encodingInput?.videoCodec === 'string' &&
          encodingInput.videoCodec.trim().length > 0
            ? encodingInput.videoCodec
            : DEFAULT.exportDefaults.encoding.videoCodec,
        bitrateMbps:
          Number.isFinite(bitrateMbps) && bitrateMbps > 0
            ? Math.min(200, Math.max(0.2, bitrateMbps))
            : DEFAULT.exportDefaults.encoding.bitrateMbps,
        excludeAudio: Boolean(encodingInput?.excludeAudio),
        audioCodec: encodingInput?.audioCodec === 'opus' ? 'opus' : 'aac',
        audioBitrateKbps:
          Number.isFinite(audioBitrateKbps) && audioBitrateKbps > 0
            ? Math.round(Math.min(1024, Math.max(32, audioBitrateKbps)))
            : DEFAULT.exportDefaults.encoding.audioBitrateKbps,
      },
    },
  };
}

function normalizeWorkspaceSettingsForTest(raw: unknown): GranVideoEditorWorkspaceSettings {
  const DEFAULT = {
    proxyStorageLimitBytes: 10 * 1024 * 1024 * 1024,
    cacheStorageLimitBytes: 2 * 1024 * 1024 * 1024,
    thumbnailsStorageLimitBytes: 1 * 1024 * 1024 * 1024,
  };

  if (!raw || typeof raw !== 'object') return { ...DEFAULT };
  const input = raw as Record<string, any>;

  const proxyStorageLimitBytes = Number(input.proxyStorageLimitBytes);
  const cacheStorageLimitBytes = Number(input.cacheStorageLimitBytes);
  const thumbnailsStorageLimitBytes = Number(input.thumbnailsStorageLimitBytes);

  return {
    proxyStorageLimitBytes:
      Number.isFinite(proxyStorageLimitBytes) && proxyStorageLimitBytes > 0
        ? Math.round(proxyStorageLimitBytes)
        : DEFAULT.proxyStorageLimitBytes,
    cacheStorageLimitBytes:
      Number.isFinite(cacheStorageLimitBytes) && cacheStorageLimitBytes > 0
        ? Math.round(cacheStorageLimitBytes)
        : DEFAULT.cacheStorageLimitBytes,
    thumbnailsStorageLimitBytes:
      Number.isFinite(thumbnailsStorageLimitBytes) && thumbnailsStorageLimitBytes > 0
        ? Math.round(thumbnailsStorageLimitBytes)
        : DEFAULT.thumbnailsStorageLimitBytes,
  };
}

describe('settings normalization', () => {
  it('migrates openBehavior to openLastProjectOnStart', () => {
    const normalized = normalizeUserSettingsForTest({ openBehavior: 'show_project_picker' });
    expect(normalized.openLastProjectOnStart).toBe(false);
  });

  it('uses exportDefaults fallback when missing', () => {
    const normalized = normalizeUserSettingsForTest({ openLastProjectOnStart: true });
    expect(normalized.exportDefaults.width).toBe(1920);
    expect(normalized.exportDefaults.encoding.format).toBe('mp4');
  });

  it('normalizes workspace limits', () => {
    const normalized = normalizeWorkspaceSettingsForTest({
      proxyStorageLimitBytes: '123',
      cacheStorageLimitBytes: 0,
      thumbnailsStorageLimitBytes: 42,
    });

    expect(normalized.proxyStorageLimitBytes).toBe(123);
    expect(normalized.cacheStorageLimitBytes).toBe(2 * 1024 * 1024 * 1024);
    expect(normalized.thumbnailsStorageLimitBytes).toBe(42);
  });
});
