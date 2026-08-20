/** @vitest-environment node */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref } from 'vue';
import { createTimelinePlaybackModule } from '~/stores/timeline/playback';
import { TICKS_PER_SECOND } from '~/utils/time';

const timelineTicks = (value: number) => value * (TICKS_PER_SECOND / 1_000_000);

vi.mock('~/utils/zoom', () => ({
  MIN_TIMELINE_ZOOM_POSITION: 0,
  MAX_TIMELINE_ZOOM_POSITION: 100,
  DEFAULT_TIMELINE_ZOOM_POSITION: 50,
}));

function createMockDeps(overrides?: Partial<Parameters<typeof createTimelinePlaybackModule>[0]>) {
  const deps = {
    currentTime: ref(0),
    isPlaying: ref(false),
    playbackSpeed: ref(1),
    timelineZoom: ref(50),
    audioVolume: ref(1),
    audioMuted: ref(false),
    duration: ref(2_540_160_000_000),
    playbackGestureHandler: ref<((nextPlaying: boolean) => void) | null>(null),
    getDocFps: () => 30,
    setCurrentTimeTicks: vi.fn((next: number) => {
      deps.currentTime.value = next;
    }),
    onPlayheadJump: vi.fn(),
    ...overrides,
  };
  return deps;
}

describe('TimelinePlaybackModule', () => {
  it('clamps playback speed between -10 and 10', () => {
    const deps = createMockDeps();
    const mod = createTimelinePlaybackModule(deps);

    mod.setPlaybackSpeed(15);
    expect(deps.playbackSpeed.value).toBe(10);

    mod.setPlaybackSpeed(-20);
    expect(deps.playbackSpeed.value).toBe(-10);

    mod.setPlaybackSpeed(0.05);
    expect(deps.playbackSpeed.value).toBe(0.1);
  });

  it('goes to start and end and signals the timeline to scroll', () => {
    const deps = createMockDeps({ currentTime: ref(1_270_080_000_000) });
    const mod = createTimelinePlaybackModule(deps);

    mod.goToEnd();
    expect(deps.currentTime.value).toBe(2_540_160_000_000);
    expect(deps.onPlayheadJump).toHaveBeenCalledTimes(1);

    mod.goToStart();
    expect(deps.currentTime.value).toBe(0);
    expect(deps.onPlayheadJump).toHaveBeenCalledTimes(2);
  });

  it('clamps timeline zoom and snaps to default', () => {
    const deps = createMockDeps();
    const mod = createTimelinePlaybackModule(deps);

    mod.setTimelineZoom(-10);
    expect(deps.timelineZoom.value).toBe(0);

    mod.setTimelineZoom(200);
    expect(deps.timelineZoom.value).toBe(100);

    // Snap to default when crossing into snap zone
    deps.timelineZoom.value = 10;
    mod.setTimelineZoom(51);
    expect(deps.timelineZoom.value).toBe(50);
  });

  it('sets audio volume and unmutes when positive', () => {
    const deps = createMockDeps({ audioMuted: ref(true) });
    const mod = createTimelinePlaybackModule(deps);

    mod.setAudioVolume(0.5);
    expect(deps.audioVolume.value).toBe(0.5);
    expect(deps.audioMuted.value).toBe(false);
  });

  it('clamps audio volume to 200%', () => {
    const deps = createMockDeps();
    const mod = createTimelinePlaybackModule(deps);

    mod.setAudioVolume(5);

    expect(deps.audioVolume.value).toBe(2);
  });

  it('toggles audio muted state', () => {
    const deps = createMockDeps();
    const mod = createTimelinePlaybackModule(deps);

    mod.toggleAudioMuted();
    expect(deps.audioMuted.value).toBe(true);

    mod.toggleAudioMuted();
    expect(deps.audioMuted.value).toBe(false);
  });

  it('toggles playback and invokes gesture handler', () => {
    const handler = vi.fn();
    const deps = createMockDeps({ playbackGestureHandler: ref(handler) });
    const mod = createTimelinePlaybackModule(deps);

    mod.togglePlayback();
    expect(handler).toHaveBeenCalledWith(true);
    expect(deps.isPlaying.value).toBe(true);

    mod.togglePlayback();
    expect(handler).toHaveBeenCalledWith(false);
    expect(deps.isPlaying.value).toBe(false);
  });

  it('stops playback and resets time', () => {
    const handler = vi.fn();
    const deps = createMockDeps({
      currentTime: ref(1_270_080_000_000),
      isPlaying: ref(true),
      playbackGestureHandler: ref(handler),
    });
    const mod = createTimelinePlaybackModule(deps);

    mod.stopPlayback();
    expect(handler).toHaveBeenCalledWith(false);
    expect(deps.isPlaying.value).toBe(false);
    expect(deps.currentTime.value).toBe(0);
  });

  it('seeks by frame count', () => {
    const deps = createMockDeps({ currentTime: ref(0) });
    const mod = createTimelinePlaybackModule(deps);

    mod.seekFrames(30);
    const expected = 30 * (254_016_000_000 / 30);
    expect(deps.setCurrentTimeTicks).toHaveBeenCalledWith(expect.closeTo(expected, 1));
  });
});
