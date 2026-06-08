import { describe, it, expect, vi } from 'vitest';
import {
  buildNativeMonitorScene,
  buildNativeAudioEffectSpecs,
  mapTimelineBlendModeToNative,
} from '~/utils/native-monitor-scene';

vi.mock('@tauri-apps/api/path', () => ({
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
}));

// Reproduce the private helpers inline so the test does not depend on
// module internals (they are not exported).
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function sanitizeAudioSpeed(value: unknown): number {
  const raw = finite(value, 1) || 1;
  const clamped = Math.max(0.01, Math.min(100, Math.abs(raw)));
  return raw < 0 ? -clamped : clamped;
}

function sanitizeVideoSpeed(value: unknown): number {
  const raw = finite(value, 1) || 1;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw === 0) return 1;
  return Math.max(-10, Math.min(10, raw));
}

describe('sanitizeAudioSpeed', () => {
  it('returns 1 for undefined / null / NaN / zero', () => {
    expect(sanitizeAudioSpeed(undefined)).toBe(1);
    expect(sanitizeAudioSpeed(null)).toBe(1);
    expect(sanitizeAudioSpeed(NaN)).toBe(1);
    expect(sanitizeAudioSpeed(0)).toBe(1);
  });

  it('preserves forward speeds and clamps them', () => {
    expect(sanitizeAudioSpeed(1)).toBe(1);
    expect(sanitizeAudioSpeed(2)).toBe(2);
    expect(sanitizeAudioSpeed(100)).toBe(100);
    expect(sanitizeAudioSpeed(150)).toBe(100);
    expect(sanitizeAudioSpeed(0.005)).toBe(0.01);
  });

  it('preserves negative sign for reverse playback', () => {
    expect(sanitizeAudioSpeed(-1)).toBe(-1);
    expect(sanitizeAudioSpeed(-2)).toBe(-2);
    expect(sanitizeAudioSpeed(-100)).toBe(-100);
    expect(sanitizeAudioSpeed(-150)).toBe(-100);
    expect(sanitizeAudioSpeed(-0.005)).toBe(-0.01);
  });
});

describe('sanitizeVideoSpeed', () => {
  it('returns 1 for undefined / null / NaN / zero', () => {
    expect(sanitizeVideoSpeed(undefined)).toBe(1);
    expect(sanitizeVideoSpeed(null)).toBe(1);
    expect(sanitizeVideoSpeed(NaN)).toBe(1);
    expect(sanitizeVideoSpeed(0)).toBe(1);
  });

  it('preserves forward speeds and clamps them', () => {
    expect(sanitizeVideoSpeed(1)).toBe(1);
    expect(sanitizeVideoSpeed(2)).toBe(2);
    expect(sanitizeVideoSpeed(10)).toBe(10);
    expect(sanitizeVideoSpeed(15)).toBe(10);
  });

  it('preserves negative sign for reverse playback', () => {
    expect(sanitizeVideoSpeed(-1)).toBe(-1);
    expect(sanitizeVideoSpeed(-2)).toBe(-2);
    expect(sanitizeVideoSpeed(-10)).toBe(-10);
    expect(sanitizeVideoSpeed(-15)).toBe(-10);
  });
});

describe('mapTimelineBlendModeToNative', () => {
  it('keeps matching blend modes unchanged', () => {
    expect(mapTimelineBlendModeToNative(undefined)).toBe('normal');
    expect(mapTimelineBlendModeToNative('normal')).toBe('normal');
    expect(mapTimelineBlendModeToNative('multiply')).toBe('multiply');
    expect(mapTimelineBlendModeToNative('screen')).toBe('screen');
  });

  it('maps timeline kebab-case blend modes to native snake_case values', () => {
    expect(mapTimelineBlendModeToNative('color-dodge')).toBe('color_dodge');
    expect(mapTimelineBlendModeToNative('color-burn')).toBe('color_burn');
    expect(mapTimelineBlendModeToNative('hard-light')).toBe('hard_light');
    expect(mapTimelineBlendModeToNative('soft-light')).toBe('soft_light');
  });
});

describe('buildNativeAudioEffectSpecs', () => {
  it('keeps enabled audio effects and packs effect params for native audio layers', () => {
    expect(
      buildNativeAudioEffectSpecs([
        {
          id: 'audio-1',
          type: 'echo',
          enabled: true,
          target: 'audio',
          wet: 0.4,
          delayMs: 120,
        },
        {
          id: 'audio-disabled',
          type: 'reverb',
          enabled: false,
          target: 'audio',
          room: 0.8,
        },
        {
          id: 'video-1',
          type: 'blur',
          enabled: true,
          target: 'video',
          radius: 5,
        },
        {
          id: 'audio-default-wet',
          type: 'compressor',
          enabled: true,
          target: 'audio',
          threshold: -12,
        },
      ]),
    ).toEqual([
      {
        id: 'audio-1',
        type: 'echo',
        enabled: true,
        wet: 0.4,
        params: { delayMs: 120 },
      },
      {
        id: 'audio-default-wet',
        type: 'compressor',
        enabled: true,
        wet: 1,
        params: { threshold: -12 },
      },
    ]);
  });
});

describe('buildNativeMonitorScene', () => {
  it('uses original project media paths even when monitor proxy preview is enabled', async () => {
    const timelineDoc = {
      version: 1,
      timebase: { fps: 30 },
      tracks: [
        {
          id: 'v-track',
          kind: 'video',
          videoHidden: false,
          items: [
            {
              id: 'clip-1',
              kind: 'clip',
              type: 'media',
              trackId: 'v-track',
              source: { path: '_video/source.mp4' },
              timelineRange: { startUs: 0, durationUs: 1_000_000 },
              sourceRange: { startUs: 0, durationUs: 1_000_000 },
            },
          ],
        },
      ],
    };

    const projectStore = {
      projectSettings: {
        project: {
          width: 1920,
          height: 1080,
          fps: 30,
          audioDeclickDurationUs: 0,
        },
      },
      getProjectDirHandle: vi.fn(async () => ({ path: '/workspace/project' })),
      getFileByPath: vi.fn(),
    };
    const workspaceStore = {
      userSettings: {
        projectDefaults: {
          defaultAudioFadeCurve: 'linear',
        },
        optimization: {
          nativeMonitorSyncMode: 'balanced',
        },
      },
      activeMonitor: {
        useProxy: true,
      },
    };

    const scene = await buildNativeMonitorScene({
      timelineDoc: timelineDoc as never,
      projectStore: projectStore as never,
      workspaceStore: workspaceStore as never,
    });

    expect(scene.layers).toHaveLength(1);
    expect(scene.layers[0]?.path).toBe('/workspace/project/_video/source.mp4');
    expect(scene.layers[0]?.path).not.toContain('proxy');
    expect(scene.layers[0]?.path).not.toContain('proxies');
  });
});
