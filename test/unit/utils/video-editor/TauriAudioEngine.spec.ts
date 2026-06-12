/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TauriAudioEngine } from '~/utils/video-editor/TauriAudioEngine';

const listenMock = vi.hoisted(() => vi.fn());
const unlistenMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
}));

const scrubPreviewMock = vi.hoisted(() => vi.fn());
const stopScrubPreviewMock = vi.hoisted(() => vi.fn());
const setOutputGainMock = vi.hoisted(() => vi.fn());

vi.mock('~/composables/monitor/native-monitor-ipc', () => ({
  MONITOR_EVENTS: {
    audioLevels: 'monitor:audio-levels',
  },
  nativeMonitorIpc: {
    scrubPreview: scrubPreviewMock,
    stopScrubPreview: stopScrubPreviewMock,
    setOutputGain: setOutputGainMock,
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
  });

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

  it('play delegates to scheduler and starts wall-clock timing', async () => {
    const engine = await createEngine();
    await engine.play(5_000_000, 2);
    const timeUs = engine.getCurrentTimeUs();
    expect(timeUs).toBeGreaterThanOrEqual(4_900_000);
    expect(timeUs).toBeLessThanOrEqual(5_100_000);
  });

  it('stop halts playback', async () => {
    const engine = await createEngine();
    await engine.play(10_000_000);
    engine.stop();
    expect(engine.getCurrentTimeUs()).toBe(10_000_000);
  });

  it('seek reanchors while playing', async () => {
    const engine = await createEngine();
    await engine.play(0);
    engine.seek(20_000_000);
    const timeUs = engine.getCurrentTimeUs();
    expect(timeUs).toBeGreaterThanOrEqual(19_900_000);
    expect(timeUs).toBeLessThanOrEqual(20_100_000);
  });

  it('seek is ignored when stopped', () => {
    const engine = new TauriAudioEngine();
    engine.seek(30_000_000);
    expect(engine.getCurrentTimeUs()).toBe(0);
  });

  it('setGlobalSpeed updates scheduler speed', async () => {
    const engine = await createEngine();
    await engine.play(0, 1);
    engine.setGlobalSpeed(2);
    expect((engine as any).scheduler.getGlobalSpeed()).toBe(2);
  });

  it('resumeContext is a no-op', async () => {
    const engine = await createEngine();
    await expect(engine.resumeContext()).resolves.toBeUndefined();
  });

  it('setMasterVolume clamps to [0, 10]', async () => {
    const engine = await createEngine();
    engine.setMasterVolume(5);
    expect((engine as any).currentMasterVolume).toBe(5);
    engine.setMasterVolume(-1);
    expect((engine as any).currentMasterVolume).toBe(0);
    engine.setMasterVolume(15);
    expect((engine as any).currentMasterVolume).toBe(10);
  });

  it('setMonitorVolume clamps to [0, 10]', async () => {
    const engine = await createEngine();
    engine.setMonitorVolume(3);
    expect((engine as any).currentMonitorVolume).toBe(3);
    engine.setMonitorVolume(-5);
    expect((engine as any).currentMonitorVolume).toBe(0);
    engine.setMonitorVolume(20);
    expect((engine as any).currentMonitorVolume).toBe(10);
  });

  it('setMonitorVolume forwards the effective gain to native output', async () => {
    const engine = await createEngine();

    engine.setMonitorVolume(0.25);
    engine.setMonitorVolume(-1);
    engine.setMonitorVolume(20);

    expect(setOutputGainMock).toHaveBeenNthCalledWith(1, 0.25);
    expect(setOutputGainMock).toHaveBeenNthCalledWith(2, 0);
    expect(setOutputGainMock).toHaveBeenNthCalledWith(3, 10);
  });

  it('getLevels returns native master levels and silence for per-track meters', async () => {
    const engine = await createEngine();
    const levelsHandler = listenMock.mock.calls[1]?.[1] as (event: {
      payload: { rmsDb: number; peakDb: number };
    }) => void;

    levelsHandler({ payload: { rmsDb: -18, peakDb: -6 } });

    expect(engine.getLevels()).toEqual({ rmsDb: -18, peakDb: -6 });
    expect(engine.getLevels('track-1')).toEqual({ rmsDb: -60, peakDb: -60 });
  });

  it('previewScrubForward delegates to native IPC for forward spans', async () => {
    const engine = await createEngine();
    await engine.previewScrubForward(1_000_000, 2_000_000);
    // Default maxPreviewDurationUs = 90_000, so 1_000_000 span is clamped to 0.09 s.
    expect(scrubPreviewMock).toHaveBeenCalledWith(1.0, 0.09);
  });

  it('previewScrubForward skips non-forward spans', async () => {
    const engine = await createEngine();
    await engine.previewScrubForward(2_000_000, 1_000_000);
    expect(scrubPreviewMock).not.toHaveBeenCalled();
  });

  it('previewScrubForward clamps duration to maxPreviewDurationUs', async () => {
    const engine = await createEngine();
    await engine.previewScrubForward(0, 200_000_000, 90_000);
    expect(scrubPreviewMock).toHaveBeenCalledWith(0, 0.09);
  });

  it('stopScrubPreview delegates to native IPC', async () => {
    const engine = await createEngine();
    engine.stopScrubPreview();
    expect(stopScrubPreviewMock).toHaveBeenCalled();
  });

  it('extractPeaks returns null', async () => {
    const engine = await createEngine();
    const result = await engine.extractPeaks(null as any, 'key');
    expect(result).toBeNull();
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

  it('syncTime event updates scheduler time', async () => {
    const engine = await createEngine();
    const handler = listenMock.mock.calls[0]?.[1] as (event: { payload: number }) => void;
    handler({ payload: 12.34 });
    expect(engine.getCurrentTimeUs()).toBe(12_340_000);
  });
});
