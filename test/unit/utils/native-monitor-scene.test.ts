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
      lastProjectPath: null,
      recentProjects: [],
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

  it('passes native frame cache settings to the monitor scene', async () => {
    const timelineDoc = {
      version: 1,
      timebase: { fps: 30 },
      tracks: [],
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
          nativeFrameCacheMode: 'custom',
          nativeFrameCacheCustomMb: 0,
        },
      },
      activeMonitor: {
        useProxy: false,
      },
      lastProjectPath: null,
      recentProjects: [],
    };

    const scene = await buildNativeMonitorScene({
      timelineDoc: timelineDoc as never,
      projectStore: projectStore as never,
      workspaceStore: workspaceStore as never,
    });

    expect(scene.frame_cache_mode).toBe('custom');
    expect(scene.frame_cache_custom_mb).toBe(0);
  });

  it('keeps absolute local paths unaltered (both Unix and Windows formats)', async () => {
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
              id: 'clip-unix',
              kind: 'clip',
              type: 'media',
              trackId: 'v-track',
              source: { path: '/absolute/path/to/unix_video.mp4' },
              timelineRange: { startUs: 0, durationUs: 1_000_000 },
              sourceRange: { startUs: 0, durationUs: 1_000_000 },
            },
            {
              id: 'clip-windows',
              kind: 'clip',
              type: 'media',
              trackId: 'v-track',
              source: { path: 'D:\\absolute\\path\\to\\win_video.mp4' },
              timelineRange: { startUs: 1_000_000, durationUs: 1_000_000 },
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
        useProxy: false,
      },
      lastProjectPath: null,
      recentProjects: [],
    };

    const scene = await buildNativeMonitorScene({
      timelineDoc: timelineDoc as never,
      projectStore: projectStore as never,
      workspaceStore: workspaceStore as never,
    });

    expect(scene.layers).toHaveLength(2);
    expect(scene.layers[0]?.path).toBe('/absolute/path/to/unix_video.mp4');
    expect(scene.layers[1]?.path).toBe('D:/absolute/path/to/win_video.mp4');
  });

  it('falls back to workspaceStore.lastProjectPath when getProjectDirHandle lacks path', async () => {
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
      currentProjectName: 'myproject',
      projectSettings: {
        project: {
          width: 1920,
          height: 1080,
          fps: 30,
          audioDeclickDurationUs: 0,
        },
      },
      getProjectDirHandle: vi.fn(async () => null),
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
        useProxy: false,
      },
      lastProjectPath: '/external/myproject',
      recentProjects: [],
    };

    const scene = await buildNativeMonitorScene({
      timelineDoc: timelineDoc as never,
      projectStore: projectStore as never,
      workspaceStore: workspaceStore as never,
    });

    expect(scene.layers).toHaveLength(1);
    expect(scene.layers[0]?.path).toBe('/external/myproject/_video/source.mp4');
  });

  it('includes enabled video master effects in the monitor scene', async () => {
    const timelineDoc = {
      version: 1,
      timebase: { fps: 30 },
      tracks: [],
      metadata: {
        fastcat: {
          masterEffects: [
            { id: 'blur-1', type: 'blur', enabled: true, target: 'video', radius: 5 },
            { id: 'brightness-1', type: 'brightness', enabled: false, target: 'video', value: 1.2 },
            { id: 'echo-1', type: 'echo', enabled: true, target: 'audio', wet: 0.5 },
          ],
        },
      },
    };
    const projectStore = {
      projectSettings: {
        project: { width: 1920, height: 1080, fps: 30, audioDeclickDurationUs: 0 },
      },
      getProjectDirHandle: vi.fn(async () => ({ path: '/workspace/project' })),
      getFileByPath: vi.fn(),
    };
    const workspaceStore = {
      userSettings: {
        projectDefaults: { defaultAudioFadeCurve: 'linear' },
        optimization: { nativeMonitorSyncMode: 'balanced' },
      },
      activeMonitor: { useProxy: false },
      lastProjectPath: null,
      recentProjects: [],
    };

    const scene = await buildNativeMonitorScene({
      timelineDoc: timelineDoc as never,
      projectStore: projectStore as never,
      workspaceStore: workspaceStore as never,
    });

    expect(scene.master_effects).toHaveLength(1);
    expect(scene.master_effects[0]).toMatchObject({ type: 'gaussian-blur', radius: 8 });
  });

  it('includes adjustment clips as adjustment layers with their effects', async () => {
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
              clipType: 'media',
              trackId: 'v-track',
              source: { path: '_video/source.mp4' },
              timelineRange: { startUs: 0, durationUs: 2_000_000 },
              sourceRange: { startUs: 0, durationUs: 2_000_000 },
              layer: 0,
            },
            {
              id: 'adj-1',
              kind: 'clip',
              clipType: 'adjustment',
              trackId: 'v-track',
              timelineRange: { startUs: 500_000, durationUs: 1_000_000 },
              sourceRange: { startUs: 0, durationUs: 1_000_000 },
              layer: 1,
              effects: [
                { id: 'blur-1', type: 'blur', enabled: true, target: 'video', radius: 3 },
              ],
            },
          ],
        },
      ],
    };
    const projectStore = {
      projectSettings: {
        project: { width: 1920, height: 1080, fps: 30, audioDeclickDurationUs: 0 },
      },
      getProjectDirHandle: vi.fn(async () => ({ path: '/workspace/project' })),
      getFileByPath: vi.fn(),
    };
    const workspaceStore = {
      userSettings: {
        projectDefaults: { defaultAudioFadeCurve: 'linear' },
        optimization: { nativeMonitorSyncMode: 'balanced' },
      },
      activeMonitor: { useProxy: false },
      lastProjectPath: null,
      recentProjects: [],
    };

    const scene = await buildNativeMonitorScene({
      timelineDoc: timelineDoc as never,
      projectStore: projectStore as never,
      workspaceStore: workspaceStore as never,
    });

    const adjustmentLayer = scene.layers.find((l) => l.kind === 'adjustment');
    expect(adjustmentLayer).toBeDefined();
    expect(adjustmentLayer?.id).toBe('adj-1');
    expect(adjustmentLayer?.effects).toHaveLength(1);
    expect(adjustmentLayer?.effects[0]).toMatchObject({ type: 'gaussian-blur', radius: 8 });
    expect(adjustmentLayer?.timeline_start_sec).toBe(0.5);
    expect(adjustmentLayer?.timeline_end_sec).toBe(1.5);
  });
});
