import { describe, expect, it, vi, beforeEach } from 'vitest';
import { reactive, effectScope } from 'vue';
import { TICKS_PER_MILLISECOND } from '~/utils/time';

import {
  useNativeMonitorBridge,
  isNativeMonitorSceneReady,
  resolveNativeAudioTrackSelection,
  shouldSyncNativeMonitorTime,
  syncNativeMonitorScene,
  syncNativeMonitorTransportAfterScene,
} from '~/composables/monitor/useNativeMonitorBridge';
import type { TimelineDocument, TimelineTrack } from '~/timeline/types';
import type { NativeMonitorScene } from '~/utils/native-monitor-scene';

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { AppData: 'AppData' },
  mkdir: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@tauri-apps/api/path', () => ({
  join: vi.fn(async (...segments: string[]) => segments.filter(Boolean).join('/')),
  appConfigDir: vi.fn(async () => '/config'),
  appDataDir: vi.fn(async () => '/data'),
  appCacheDir: vi.fn(async () => '/cache'),
  documentDir: vi.fn(async () => '/documents'),
  tempDir: vi.fn(async () => '/tmp'),
  resolve: vi.fn(async (...segments: string[]) => segments.filter(Boolean).join('/')),
}));

// Mock stores
const mockWorkspaceStore = reactive({
  userSettings: {
    experimentalFeatures: false,
    audioEngine: {
      bufferSize: 512,
      backend: 'alsa',
    },
    optimization: {
      nativeMonitorSyncMode: 'balanced',
      nativeFrameCacheMode: 'auto',
      nativeFrameCacheCustomMb: 512,
    },
  },
  inDevelopmentFeaturesEnabled: false,
  resolvedStorageTopology: {
    commonRoot: '/',
    projectsRoot: '/',
    proxiesRoot: 'proxies',
    tempRoot: 'temp',
    ephemeralTmpRoot: 'temp',
  },
});

const mockTimelineStore = reactive({
  timelineDoc: null,
  timelineFormat: null,
  masterGain: 1,
  audioMuted: false,
  isPlaying: false,
  playbackSpeed: 1,
  currentTime: 0,
  audioLevels: {},
});

const mockProjectStore = reactive({
  currentProjectName: null,
  currentTimelinePath: null,
  activeMonitor: null,
  getProjectDirHandle: vi.fn().mockResolvedValue(null),
});

const mockProxyStore = reactive({
  existingProxies: [],
  getProxyNativePath: vi.fn(),
});

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));
vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => mockTimelineStore,
}));
vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => mockProjectStore,
}));
vi.mock('~/stores/proxy.store', () => ({
  useProxyStore: () => mockProxyStore,
}));
vi.mock('~/utils/runtime', () => ({
  isTauriRuntime: () => true,
}));

// Mock native-monitor-ipc
const mockSetAudioSettings = vi.fn().mockResolvedValue(undefined);
const mockSetSpeed = vi.fn().mockResolvedValue(undefined);
const mockSetScene = vi.fn().mockResolvedValue(undefined);

vi.mock('~/composables/monitor/native-monitor-ipc', () => ({
  nativeMonitorIpc: {
    setAudioSettings: (...args: any[]) => mockSetAudioSettings(...args),
    setSpeed: (...args: any[]) => mockSetSpeed(...args),
    setScene: (...args: any[]) => mockSetScene(...args),
    pause: () => Promise.resolve(),
    setViewport: () => Promise.resolve(),
  },
  onMonitorTime: () => Promise.resolve(() => {}),
  onMonitorEnded: () => Promise.resolve(() => {}),
  MONITOR_EVENTS: { audioLevels: 'audioLevels' },
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

function track(id: string, kind: 'audio' | 'video', props: Partial<TimelineTrack>): TimelineTrack {
  return {
    id,
    kind,
    name: id,
    items: [],
    ...props,
  } as TimelineTrack;
}

describe('resolveNativeAudioTrackSelection', () => {
  it('uses muted filters when no track is soloed', () => {
    const result = resolveNativeAudioTrackSelection({
      visibleVideoTracks: [
        track('v1', 'video', { audioMuted: false }),
        track('v2', 'video', { audioMuted: true }),
      ],
      audioTracks: [
        track('a1', 'audio', { audioMuted: true }),
        track('a2', 'audio', { audioMuted: false }),
      ],
    });

    expect(result.hasAudioSolo).toBe(false);
    expect(result.videoTracksForAudio.map((t) => t.id)).toEqual(['v1']);
    expect(result.audioTracksForAudio.map((t) => t.id)).toEqual(['a2']);
  });

  it('lets solo override muted state for native audio preview', () => {
    const result = resolveNativeAudioTrackSelection({
      visibleVideoTracks: [
        track('v1', 'video', { audioMuted: false }),
        track('v2', 'video', { audioMuted: true, audioSolo: true }),
      ],
      audioTracks: [
        track('a1', 'audio', { audioMuted: false }),
        track('a2', 'audio', { audioMuted: true, audioSolo: true }),
      ],
    });

    expect(result.hasAudioSolo).toBe(true);
    expect(result.videoTracksForAudio.map((t) => t.id)).toEqual(['v2']);
    expect(result.audioTracksForAudio.map((t) => t.id)).toEqual(['a2']);
  });
});

describe('shouldSyncNativeMonitorTime', () => {
  it('throttles small native time updates', () => {
    expect(shouldSyncNativeMonitorTime({ diffTicks: 300, nowMs: 100, lastSyncMs: 0 })).toBe(false);
    expect(
      shouldSyncNativeMonitorTime({
        diffTicks: 10 * TICKS_PER_MILLISECOND,
        nowMs: 120,
        lastSyncMs: 100,
      }),
    ).toBe(false);
    expect(
      shouldSyncNativeMonitorTime({
        diffTicks: 10 * TICKS_PER_MILLISECOND,
        nowMs: 160,
        lastSyncMs: 100,
      }),
    ).toBe(true);
  });

  it('forces large native time jumps through the throttle', () => {
    expect(
      shouldSyncNativeMonitorTime({
        diffTicks: 120 * TICKS_PER_MILLISECOND,
        nowMs: 120,
        lastSyncMs: 100,
      }),
    ).toBe(true);
  });
});

describe('isNativeMonitorSceneReady', () => {
  const emptyDoc = {
    id: 'timeline-1',
    name: 'Timeline 1',
    tracks: [],
  } as TimelineDocument;

  it('blocks native scene sync before the active project timeline is loaded', () => {
    expect(
      isNativeMonitorSceneReady({
        currentProjectName: null,
        currentTimelinePath: null,
        timelineDoc: null,
      }),
    ).toBe(false);

    expect(
      isNativeMonitorSceneReady({
        currentProjectName: 'Project',
        currentTimelinePath: null,
        timelineDoc: emptyDoc,
      }),
    ).toBe(false);
  });

  it('allows an already opened empty timeline to clear the native scene', () => {
    expect(
      isNativeMonitorSceneReady({
        currentProjectName: 'Project',
        currentTimelinePath: 'timelines/Project_001.otio',
        timelineDoc: emptyDoc,
      }),
    ).toBe(true);
  });
});

describe('syncNativeMonitorTransportAfterScene', () => {
  it('pauses native transport after scene sync when the store is not playing', async () => {
    const pause = vi.fn(async () => undefined);

    await syncNativeMonitorTransportAfterScene({
      isPlaying: false,
      isNativeMonitorDisabled: () => false,
      pause,
      warnFailure: vi.fn(),
    });

    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('does not pause while playback is active', async () => {
    const pause = vi.fn(async () => undefined);

    await syncNativeMonitorTransportAfterScene({
      isPlaying: true,
      isNativeMonitorDisabled: () => false,
      pause,
      warnFailure: vi.fn(),
    });

    expect(pause).not.toHaveBeenCalled();
  });

  it('routes pause failures through the bridge failure handler', async () => {
    const error = new Error('pause failed');
    const warnFailure = vi.fn();

    await syncNativeMonitorTransportAfterScene({
      isPlaying: false,
      isNativeMonitorDisabled: () => false,
      pause: vi.fn(async () => {
        throw error;
      }),
      warnFailure,
    });

    expect(warnFailure).toHaveBeenCalledWith('monitor pause after scene sync failed', error);
  });
});

describe('syncNativeMonitorScene', () => {
  const scene = {
    layers: [],
    audio_layers: [],
    audio_tracks: [],
    audio_master_gain: 1,
    audio_master_muted: false,
    audio_master_effects: [],
    width: 1920,
    height: 1080,
    preview_scale: 1,
    preview_fps: 30,
    preview_sync_mode: 'balanced',
    preview_effect_quality: 'ultra',
    frame_cache_mode: 'auto',
    frame_cache_custom_mb: 0,
    master_effects: [],
  } as NativeMonitorScene;

  it('pauses before replacing a scene while the timeline is stopped', async () => {
    const calls: string[] = [];

    await syncNativeMonitorScene({
      scene,
      isPlaying: () => false,
      isNativeMonitorDisabled: () => false,
      setScene: vi.fn(async () => {
        calls.push('scene');
      }),
      pause: vi.fn(async () => {
        calls.push('pause');
      }),
      warnFailure: vi.fn(),
    });

    expect(calls).toEqual(['pause', 'scene', 'pause']);
  });

  it('does not pause scene replacement during active playback', async () => {
    const pause = vi.fn(async () => undefined);
    const setScene = vi.fn(async () => undefined);

    await syncNativeMonitorScene({
      scene,
      isPlaying: () => true,
      isNativeMonitorDisabled: () => false,
      setScene,
      pause,
      warnFailure: vi.fn(),
    });

    expect(setScene).toHaveBeenCalledWith(scene);
    expect(pause).not.toHaveBeenCalled();
  });
});

describe('useNativeMonitorBridge settings sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends default audio settings when experimentalFeatures is false, and custom settings when true', async () => {
    mockWorkspaceStore.userSettings.experimentalFeatures = false;
    mockWorkspaceStore.inDevelopmentFeaturesEnabled = false;
    mockWorkspaceStore.userSettings.audioEngine.bufferSize = 512;
    mockWorkspaceStore.userSettings.audioEngine.backend = 'alsa';

    const scope = effectScope();
    scope.run(() => {
      useNativeMonitorBridge();
    });

    // Wait for watch to trigger
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should have sent default settings
    expect(mockSetAudioSettings).toHaveBeenLastCalledWith({
      bufferSize: 'default',
      backend: 'default',
    });

    // Turn on experimentalFeatures
    mockWorkspaceStore.userSettings.experimentalFeatures = true;
    mockWorkspaceStore.inDevelopmentFeaturesEnabled = true;
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should have sent the custom settings
    expect(mockSetAudioSettings).toHaveBeenLastCalledWith({
      bufferSize: 512,
      backend: 'alsa',
    });

    // Turn off experimentalFeatures again
    mockWorkspaceStore.userSettings.experimentalFeatures = false;
    mockWorkspaceStore.inDevelopmentFeaturesEnabled = false;
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should have reverted to default settings
    expect(mockSetAudioSettings).toHaveBeenLastCalledWith({
      bufferSize: 'default',
      backend: 'default',
    });

    scope.stop();
  });
});
