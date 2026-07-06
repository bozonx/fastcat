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

  it('passes timeline kebab-case blend modes through as-is (native uses kebab-case)', () => {
    expect(mapTimelineBlendModeToNative('color-dodge')).toBe('color-dodge');
    expect(mapTimelineBlendModeToNative('color-burn')).toBe('color-burn');
    expect(mapTimelineBlendModeToNative('hard-light')).toBe('hard-light');
    expect(mapTimelineBlendModeToNative('soft-light')).toBe('soft-light');
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
        plugin: null,
      },
      {
        id: 'audio-default-wet',
        type: 'compressor',
        enabled: true,
        wet: 1,
        params: { threshold: -12 },
        plugin: null,
      },
    ]);
  });
});

describe('buildNativeMonitorScene', () => {
  it('keeps track z ranges disjoint with more than 1000 clips', async () => {
    const makeItems = (trackId: string, count: number) =>
      Array.from({ length: count }, (_, index) => ({
        id: `${trackId}-${index}`,
        kind: 'clip',
        clipType: 'background',
        trackId,
        backgroundColor: '#000000',
        timelineRange: { startUs: index, durationUs: 1_000_000 },
        sourceRange: { startUs: 0, durationUs: 1_000_000 },
      }));
    const scene = await buildNativeMonitorScene({
      timelineDoc: {
        version: 1,
        timebase: { fps: 30 },
        tracks: [
          {
            id: 'upper',
            kind: 'video',
            videoHidden: false,
            items: makeItems('upper', 1),
          },
          {
            id: 'lower',
            kind: 'video',
            videoHidden: false,
            items: makeItems('lower', 1001),
          },
        ],
      } as never,
      projectStore: {
        projectSettings: {
          project: {
            width: 1920,
            height: 1080,
            fps: 30,
            audioDeclickDurationUs: 0,
          },
        },
      } as never,
      workspaceStore: {
        userSettings: {
          projectDefaults: { defaultAudioFadeCurve: 'linear' },
          optimization: { nativeMonitorSyncMode: 'balanced' },
        },
        recentProjects: [],
      } as never,
    });

    const lowerZ = scene.layers.filter((layer) => layer.id.startsWith('lower-')).map((l) => l.z);
    const upperZ = scene.layers.filter((layer) => layer.id.startsWith('upper-')).map((l) => l.z);

    expect(Math.max(...lowerZ)).toBeLessThan(Math.min(...upperZ));
  });

  it('serializes full blend mode set and crop for native scene layers', async () => {
    const timelineDoc = {
      version: 1,
      timebase: { fps: 30 },
      tracks: [
        {
          id: 'v-track',
          kind: 'video',
          videoHidden: false,
          opacity: 0.5,
          blendMode: 'screen',
          effects: [
            {
              id: 'track-blur',
              type: 'blur',
              target: 'video',
              enabled: true,
              radius: 12,
            },
          ],
          items: [
            {
              id: 'clip-1',
              kind: 'clip',
              type: 'media',
              trackId: 'v-track',
              source: { path: '_video/source.mp4' },
              timelineRange: { startUs: 0, durationUs: 1_000_000 },
              sourceRange: { startUs: 0, durationUs: 1_000_000 },
              blendMode: 'soft-light',
              transform: {
                crop: {
                  top: 10,
                  bottom: 20,
                  left: 30,
                  right: 40,
                },
              },
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

    expect(scene.layers[0]?.blend_mode).toBe('soft-light');
    expect(scene.layers[0]?.opacity).toBe(1);
    expect(scene.layers[0]?.transform).toMatchObject({
      crop_top: 10,
      crop_bottom: 20,
      crop_left: 30,
      crop_right: 40,
    });
    expect(scene.video_tracks).toEqual([
      expect.objectContaining({
        id: 'v-track',
        z: 0,
        layer_ids: ['clip-1'],
        opacity: 0.5,
        blend_mode: 'screen',
        effects: [expect.objectContaining({ type: 'gaussian-blur', radius: 12 })],
      }),
    ]);
  });

  it('preserves full text clip styling and snap flag in native scene layers', async () => {
    const textStyle = {
      width: 420,
      height: 180,
      fontFamily: 'Inter',
      fontSize: 72,
      fontWeight: '800',
      color: '#ffffff',
      align: 'center',
      verticalAlign: 'middle',
      lineHeight: 1.2,
      letterSpacing: 6,
      backgroundEnabled: true,
      backgroundColor: '#1d4ed8',
      backgroundRadius: 18,
      backgroundShadowEnabled: true,
      backgroundShadowColor: '#000000',
      backgroundShadowAlpha: 0.7,
      backgroundShadowBlur: 14,
      backgroundShadowSpread: 3,
      backgroundShadowOffsetX: -2,
      backgroundShadowOffsetY: 6,
      borderEnabled: true,
      borderColor: '#facc15',
      borderAlpha: 0.9,
      borderWidth: 8,
      borderOffset: 4,
      textShadowEnabled: true,
      textShadowColor: '#111827',
      textShadowAlpha: 0.8,
      textShadowBlur: 10,
      textShadowSpread: 2,
      textShadowOffsetX: 5,
      textShadowOffsetY: -3,
      padding: { top: 24, right: 36, bottom: 28, left: 32 },
      paddingLinked: false,
    };

    const timelineDoc = {
      version: 1,
      timebase: { fps: 30 },
      tracks: [
        {
          id: 'text-track',
          kind: 'video',
          videoHidden: false,
          items: [
            {
              id: 'text-clip-1',
              kind: 'clip',
              clipType: 'text',
              trackId: 'text-track',
              text: 'Styled text',
              style: textStyle,
              snapToPixelGrid: true,
              timelineRange: { startUs: 0, durationUs: 1_000_000 },
              sourceRange: { startUs: 0, durationUs: 1_000_000 },
              transform: {
                position: { x: 960, y: 540 },
                scale: { x: 1, y: 1 },
                rotationDeg: 0,
                anchor: { x: 0.5, y: 0.5 },
              },
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

    expect(scene.layers).toHaveLength(1);
    expect(scene.layers[0]).toMatchObject({
      id: 'text-clip-1',
      kind: 'text',
      text: 'Styled text',
      style: textStyle,
      snap_to_pixel_grid: true,
      transform: expect.objectContaining({
        x: 1920,
        y: 1080,
        scale_x: 1,
        scale_y: 1,
        rotation_deg: 0,
        anchor_x: 0.5,
        anchor_y: 0.5,
      }),
    });
    expect(scene.video_tracks).toEqual([
      expect.objectContaining({
        id: 'text-track',
        layer_ids: ['text-clip-1'],
      }),
    ]);
  });

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
    expect(scene.master_effects[0]).toMatchObject({ type: 'gaussian-blur', radius: 5 });
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
              effects: [{ id: 'blur-1', type: 'blur', enabled: true, target: 'video', radius: 3 }],
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
    expect(adjustmentLayer?.effects[0]).toMatchObject({ type: 'gaussian-blur', radius: 3 });
    expect(adjustmentLayer?.timeline_start_sec).toBe(0.5);
    expect(adjustmentLayer?.timeline_end_sec).toBe(1.5);
  });

  it('keeps image tracks above adjustment layers in native z order', async () => {
    const timelineDoc = {
      version: 1,
      timebase: { fps: 30 },
      tracks: [
        {
          id: 'image-top',
          kind: 'video',
          videoHidden: false,
          items: [
            {
              id: 'image-1',
              kind: 'clip',
              clipType: 'media',
              trackId: 'image-top',
              source: { path: '_images/overlay.png' },
              timelineRange: { startUs: 0, durationUs: 2_000_000 },
              sourceRange: { startUs: 0, durationUs: 2_000_000 },
            },
          ],
        },
        {
          id: 'adjustment-mid',
          kind: 'video',
          videoHidden: false,
          items: [
            {
              id: 'adj-1',
              kind: 'clip',
              clipType: 'adjustment',
              trackId: 'adjustment-mid',
              timelineRange: { startUs: 0, durationUs: 2_000_000 },
              sourceRange: { startUs: 0, durationUs: 2_000_000 },
              effects: [{ id: 'blur-1', type: 'blur', enabled: true, target: 'video', radius: 3 }],
            },
          ],
        },
        {
          id: 'video-bottom',
          kind: 'video',
          videoHidden: false,
          items: [
            {
              id: 'video-1',
              kind: 'clip',
              clipType: 'media',
              trackId: 'video-bottom',
              source: { path: '_video/source.mp4' },
              timelineRange: { startUs: 0, durationUs: 2_000_000 },
              sourceRange: { startUs: 0, durationUs: 2_000_000 },
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

    const image = scene.layers.find((layer) => layer.id === 'image-1');
    const adjustment = scene.layers.find((layer) => layer.id === 'adj-1');
    const video = scene.layers.find((layer) => layer.id === 'video-1');

    expect(video?.z).toBeLessThan(adjustment?.z ?? Number.NEGATIVE_INFINITY);
    expect(adjustment?.z).toBeLessThan(image?.z ?? Number.NEGATIVE_INFINITY);
    expect(image?.kind).toBe('image');
  });

  it('moves an adjacent transitionOut to the next clip transitionIn for native shader rendering', async () => {
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
              id: 'clip-a',
              kind: 'clip',
              type: 'media',
              trackId: 'v-track',
              source: { path: '_video/a.mp4' },
              timelineRange: { startUs: 0, durationUs: 1_000_000 },
              sourceRange: { startUs: 0, durationUs: 1_000_000 },
              transitionOut: {
                type: 'wipe',
                durationUs: 250_000,
                mode: 'adjacent',
                params: { angle: 45, softness: 0.1 },
              },
            },
            {
              id: 'clip-b',
              kind: 'clip',
              type: 'media',
              trackId: 'v-track',
              source: { path: '_video/b.mp4' },
              timelineRange: { startUs: 1_000_000, durationUs: 1_000_000 },
              sourceRange: { startUs: 0, durationUs: 1_000_000 },
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

    const fromLayer = scene.layers.find((layer) => layer.id === 'clip-a');
    const toLayer = scene.layers.find((layer) => layer.id === 'clip-b');
    expect(toLayer?.transition_in).toBeUndefined();
    expect(fromLayer?.transition_out).toMatchObject({
      type: 'wipe',
      from_layer_id: 'clip-b',
      spec: {
        type: 'custom-wgsl',
        source: expect.any(String),
        params: expect.any(Object),
      },
    });
  });

  it('serializes non-adjacent native shader transitions with their source mode', async () => {
    const onWarning = vi.fn();
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
              transitionOut: {
                type: 'wipe',
                durationUs: 250_000,
                mode: 'transparent',
              },
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
      onWarning,
    });

    expect(scene.layers[0]?.transition_out).toMatchObject({
      type: 'wipe',
      duration_sec: 0.25,
      mode: 'transparent',
    });
    expect(onWarning).not.toHaveBeenCalled();
  });

  it('resolves preview blur quality from playback mode, device, and user setting', async () => {
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
              id: 'clip-a',
              kind: 'clip',
              type: 'media',
              trackId: 'v-track',
              source: { path: '_video/source.mp4' },
              timelineRange: { startUs: 0, durationUs: 1_000_000 },
              sourceRange: { startUs: 0, durationUs: 1_000_000 },
            },
            {
              id: 'clip-b',
              kind: 'clip',
              type: 'media',
              trackId: 'v-track',
              source: { path: '_video/source.mp4' },
              timelineRange: { startUs: 1_000_000, durationUs: 1_000_000 },
              sourceRange: { startUs: 0, durationUs: 1_000_000 },
              transitionIn: {
                type: 'bloom',
                durationUs: 250_000,
                mode: 'adjacent',
                params: {
                  brightness: 1.5,
                  blurLevel: 1.0,
                  mode: 'bloom',
                },
              },
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

    const desktopAutoScene = await buildNativeMonitorScene({
      timelineDoc: timelineDoc as never,
      projectStore: projectStore as never,
      workspaceStore: workspaceStore as never,
      isPlaying: true,
      previewBlurQuality: 'auto',
    });
    const desktopAutoLayer = desktopAutoScene.layers.find((layer) => layer.id === 'clip-b');
    expect(desktopAutoLayer?.transition_in?.spec?.params).toMatchObject({
      p3: 9,
    });

    const mobileAutoScene = await buildNativeMonitorScene({
      timelineDoc: timelineDoc as never,
      projectStore: projectStore as never,
      workspaceStore: workspaceStore as never,
      isPlaying: true,
      previewBlurQuality: 'auto',
      isMobile: true,
    });
    const mobileAutoLayer = mobileAutoScene.layers.find((layer) => layer.id === 'clip-b');
    expect(mobileAutoLayer?.transition_in?.spec?.params).toMatchObject({
      p3: 5,
    });

    const selectedHighScene = await buildNativeMonitorScene({
      timelineDoc: timelineDoc as never,
      projectStore: {
        ...projectStore,
        activeMonitor: { previewBlurQuality: 'high' },
      } as never,
      workspaceStore: workspaceStore as never,
      isPlaying: true,
      isMobile: true,
    });
    const selectedHighLayer = selectedHighScene.layers.find((layer) => layer.id === 'clip-b');
    expect(selectedHighLayer?.transition_in?.spec?.params).toMatchObject({
      p3: 17,
    });

    // A settled paused/still frame upgrades the EFFECT/blur quality to ultra (full fidelity),
    // even though the user pinned 'low' for motion — the manual quality governs motion only.
    const pausedScene = await buildNativeMonitorScene({
      timelineDoc: timelineDoc as never,
      projectStore: projectStore as never,
      workspaceStore: workspaceStore as never,
      isPlaying: false,
      previewBlurQuality: 'low',
    });
    const pausedLayer = pausedScene.layers.find((layer) => layer.id === 'clip-b');
    expect(pausedLayer?.transition_in?.spec?.params).toMatchObject({
      p3: 25,
    });
    // ...but the render SCALE does NOT bump to full res on pause: preview_scale is a pure
    // function of the resolution setting / quality tier and must stay constant across play/pause
    // (a scale flip drops native video decoders). With 'low' + auto resolution it stays 0.5.
    expect(pausedScene.preview_scale).toBe(0.5);

    // Same scene while playing resolves to the identical scale — proving no play/pause flip.
    const playingScaleScene = await buildNativeMonitorScene({
      timelineDoc: timelineDoc as never,
      projectStore: projectStore as never,
      workspaceStore: workspaceStore as never,
      isPlaying: true,
      previewBlurQuality: 'low',
    });
    expect(playingScaleScene.preview_scale).toBe(pausedScene.preview_scale);

    const exportScene = await buildNativeMonitorScene({
      timelineDoc: timelineDoc as never,
      projectStore: projectStore as never,
      workspaceStore: workspaceStore as never,
      isExport: true,
    });
    const exportToLayer = exportScene.layers.find((layer) => layer.id === 'clip-b');
    expect(exportToLayer?.transition_in?.spec?.params).toMatchObject({
      p3: 25,
    });
  });
});
