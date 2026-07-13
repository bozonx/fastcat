/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TauriAudioEngine } from '~/utils/video-editor/TauriAudioEngine';
import { runAudioEngineContract } from './audio-engine-contract';
import { timelineUs } from '../timeline-time';

const listenMock = vi.hoisted(() => vi.fn());
const unlistenMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
}));

const scrubPreviewMock = vi.hoisted(() => vi.fn());
const stopScrubPreviewMock = vi.hoisted(() => vi.fn());
const setOutputGainMock = vi.hoisted(() => vi.fn());
const setMasterGainMock = vi.hoisted(() => vi.fn());

vi.mock('~/composables/monitor/native-monitor-ipc', () => ({
  MONITOR_EVENTS: {
    audioLevels: 'monitor:audio-levels',
  },
  nativeMonitorIpc: {
    scrubPreview: scrubPreviewMock,
    stopScrubPreview: stopScrubPreviewMock,
    setOutputGain: setOutputGainMock,
    setMasterGain: setMasterGainMock,
  },
}));

async function createEngine(): Promise<TauriAudioEngine> {
  const engine = new TauriAudioEngine();
  // Allow the async listen() inside the constructor to settle.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return engine;
}

describe('TauriAudioEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listenMock.mockResolvedValue(unlistenMock);
    scrubPreviewMock.mockResolvedValue(undefined);
    stopScrubPreviewMock.mockResolvedValue(undefined);
    setOutputGainMock.mockResolvedValue(undefined);
    setMasterGainMock.mockResolvedValue(undefined);
  });

  // Cross-engine behaviour shared with WebAudioEngine (transport clock, idle
  // metering silence, capability-gated peaks, tolerant setters).
  runAudioEngineContract('TauriAudioEngine', { createEngine });

  it('declares correct capabilities', async () => {
    const engine = await createEngine();
    expect(engine.capabilities).toEqual({
      scrubPreview: true,
      peaksExtraction: false,
      levelMetering: true,
    });
  });

  it('init resolves immediately (no Web Audio context)', async () => {
    const engine = await createEngine();
    await expect(engine.init()).resolves.toBeUndefined();
    await expect(engine.init({ sampleRate: 44100 })).resolves.toBeUndefined();
  });

  it('loadClips stores clips', async () => {
    const engine = await createEngine();
    const clips = [{ id: 'c1', sourcePath: '/a.mp3' } as any];
    await engine.loadClips(clips);
    expect((engine as any).currentClips).toEqual(clips);
  });

  it('updateTimelineLayout replaces clips', async () => {
    const engine = await createEngine();
    const first = [{ id: 'c1', sourcePath: '/a.mp3' } as any];
    const second = [{ id: 'c2', sourcePath: '/b.mp3' } as any];
    await engine.loadClips(first);
    await engine.updateTimelineLayout(second);
    expect((engine as any).currentClips).toEqual(second);
  });

  it('setGlobalSpeed updates scheduler speed', async () => {
    const engine = await createEngine();
    await engine.play(0, 1);
    engine.setGlobalSpeed(2);
    expect((engine as any).scheduler.getGlobalSpeed()).toBe(2);
  });

  it('setMasterVolume clamps user-facing gain to [0, 2]', async () => {
    const engine = await createEngine();
    engine.setMasterVolume(1.5);
    expect((engine as any).currentMasterVolume).toBe(1.5);
    engine.setMasterVolume(-1);
    expect((engine as any).currentMasterVolume).toBe(0);
    engine.setMasterVolume(15);
    expect((engine as any).currentMasterVolume).toBe(2);
    expect(setMasterGainMock).toHaveBeenNthCalledWith(1, 1.5);
    expect(setMasterGainMock).toHaveBeenNthCalledWith(2, 0);
    expect(setMasterGainMock).toHaveBeenNthCalledWith(3, 2);
  });

  it('setMonitorVolume clamps to [0, 2]', async () => {
    const engine = await createEngine();
    engine.setMonitorVolume(1.5);
    expect((engine as any).currentMonitorVolume).toBe(1.5);
    engine.setMonitorVolume(-5);
    expect((engine as any).currentMonitorVolume).toBe(0);
    engine.setMonitorVolume(20);
    expect((engine as any).currentMonitorVolume).toBe(2);
  });

  it('setMonitorVolume forwards the effective gain to native output', async () => {
    const engine = await createEngine();

    engine.setMonitorVolume(0.25);
    engine.setMonitorVolume(-1);
    engine.setMonitorVolume(20);

    expect(setOutputGainMock).toHaveBeenNthCalledWith(1, 0.25);
    expect(setOutputGainMock).toHaveBeenNthCalledWith(2, 0);
    expect(setOutputGainMock).toHaveBeenNthCalledWith(3, 2);
  });

  it('getLevels returns native master levels and track levels when present', async () => {
    const engine = await createEngine();
    await engine.play(0);
    const levelsHandler = listenMock.mock.calls[1]?.[1] as (event: { payload: any }) => void;

    levelsHandler({
      payload: {
        rmsDb: -18,
        peakDb: -6,
        tracks: {
          'track-1': { rmsDb: -12, peakDb: -3 },
        },
      },
    });

    expect(engine.getLevels()).toEqual({ rmsDb: -18, peakDb: -6 });
    expect(engine.getLevels('track-1')).toEqual({ rmsDb: -12, peakDb: -3 });
    expect(engine.getLevels('track-2')).toEqual({ rmsDb: -60, peakDb: -60 });
  });

  it('getLevels returns silence while paused', async () => {
    const engine = await createEngine();
    await engine.play(0);
    const levelsHandler = listenMock.mock.calls[1]?.[1] as (event: { payload: any }) => void;
    levelsHandler({ payload: { rmsDb: -18, peakDb: -6 } });

    engine.stop();

    expect(engine.getLevels()).toEqual({ rmsDb: -60, peakDb: -60 });
  });

  it('previewScrubForward delegates to native IPC for forward spans', async () => {
    const engine = await createEngine();
    await engine.previewScrubForward(timelineUs(1_000_000), timelineUs(2_000_000));
    // Default maxPreviewDurationUs = 90_000, so 1_000_000 span is clamped to 0.09 s.
    expect(scrubPreviewMock).toHaveBeenCalledWith(1.0, 0.09);
  });

  it('previewScrubForward skips non-forward spans', async () => {
    const engine = await createEngine();
    await engine.previewScrubForward(timelineUs(2_000_000), timelineUs(1_000_000));
    expect(scrubPreviewMock).not.toHaveBeenCalled();
  });

  it('previewScrubForward clamps duration to maxPreviewDurationUs', async () => {
    const engine = await createEngine();
    await engine.previewScrubForward(0, timelineUs(200_000_000), timelineUs(90_000));
    expect(scrubPreviewMock).toHaveBeenCalledWith(0, 0.09);
  });

  it('stopScrubPreview delegates to native IPC', async () => {
    const engine = await createEngine();
    engine.stopScrubPreview();
    expect(stopScrubPreviewMock).toHaveBeenCalled();
  });

  it('destroy unregisters time listener and marks destroyed', async () => {
    const engine = await createEngine();
    engine.destroy();
    expect(unlistenMock).toHaveBeenCalledTimes(2);
    expect((engine as any).destroyed).toBe(true);
  });

  it('destroy is safe to call twice', async () => {
    const engine = await createEngine();
    engine.destroy();
    engine.destroy();
    expect(unlistenMock).toHaveBeenCalledTimes(2);
  });

  it('unregisters listeners that resolve after destroy', async () => {
    const resolvers: Array<(unlisten: () => void) => void> = [];
    listenMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve as (unlisten: () => void) => void);
        }),
    );

    const engine = new TauriAudioEngine();
    engine.destroy();

    for (const resolve of resolvers) {
      resolve(unlistenMock);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(unlistenMock).toHaveBeenCalledTimes(2);
  });

  it('syncTime event updates scheduler time when playing', async () => {
    const engine = await createEngine();
    await engine.play(0);
    const handler = listenMock.mock.calls[0]?.[1] as (event: { payload: number }) => void;
    handler({ payload: 12.34 });
    // Allow small wall-clock drift since Tauri uses performance.now()
    expect(Math.abs(engine.getCurrentTimeUs() - timelineUs(12_340_000))).toBeLessThan(
      timelineUs(10),
    );
  });

  it('syncTime event is ignored when not playing', async () => {
    const engine = await createEngine();
    const handler = listenMock.mock.calls[0]?.[1] as (event: { payload: number }) => void;
    handler({ payload: 12.34 });
    // Should remain at 0 since syncTime is guarded by isPlaying
    expect(engine.getCurrentTimeUs()).toBe(0);
  });

  // ── Engine-specific: IPC delegation & lifecycle ───────────────────────

  it('play delegates to scheduler with correct time and speed', async () => {
    const engine = await createEngine();
    await engine.play(timelineUs(5_000_000), 2);
    expect((engine as any).scheduler.isPlayingActive()).toBe(true);
    expect((engine as any).scheduler.getBaseTimeS()).toBe(5);
    expect((engine as any).scheduler.getGlobalSpeed()).toBe(2);
  });

  it('stop delegates to scheduler', async () => {
    const engine = await createEngine();
    await engine.play(0);
    engine.stop();
    expect((engine as any).scheduler.isPlayingActive()).toBe(false);
  });

  it('seek delegates to scheduler', async () => {
    const engine = await createEngine();
    await engine.play(0);
    engine.seek(timelineUs(10_000_000));
    expect((engine as any).scheduler.getBaseTimeS()).toBe(10);
  });

  it('setMasterVolume IPC error is caught and does not throw', async () => {
    setMasterGainMock.mockRejectedValueOnce(new Error('IPC failed'));
    const engine = await createEngine();
    expect(() => engine.setMasterVolume(1)).not.toThrow();
  });

  it('setMonitorVolume IPC error is caught and does not throw', async () => {
    setOutputGainMock.mockRejectedValueOnce(new Error('IPC failed'));
    const engine = await createEngine();
    expect(() => engine.setMonitorVolume(1)).not.toThrow();
  });

  it('setMasterAudioEffects is a no-op', async () => {
    const engine = await createEngine();
    expect(() => engine.setMasterAudioEffects([])).not.toThrow();
  });

  it('resumeContext is a no-op', async () => {
    const engine = await createEngine();
    await expect(engine.resumeContext()).resolves.toBeUndefined();
  });

  it('extractPeaks returns null (native-only feature)', async () => {
    const engine = await createEngine();
    const result = await engine.extractPeaks(null as any, 'key');
    expect(result).toBeNull();
  });

  it('getCurrentTimeUs delegates to scheduler', async () => {
    const engine = await createEngine();
    await engine.play(3_000_000);
    expect(engine.getCurrentTimeUs()).toBeCloseTo(3_000_000, -5);
  });

  it('setGlobalSpeed delegates to scheduler', async () => {
    const engine = await createEngine();
    await engine.play(0);
    engine.setGlobalSpeed(1.5);
    expect((engine as any).scheduler.getGlobalSpeed()).toBe(1.5);
  });
});
