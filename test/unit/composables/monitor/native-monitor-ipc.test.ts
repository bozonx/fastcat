import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  nativeMonitorIpc,
  onMonitorTime,
  onMonitorEnded,
  MONITOR_EVENTS,
  toMonitorAudioSettingsPayload,
} from '~/composables/monitor/native-monitor-ipc';

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async () => undefined),
  listenMock: vi.fn(async () => () => {}),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  Channel: class {},
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

describe('native-monitor-ipc', () => {
  beforeEach(() => {
    invokeMock.mockClear();
    listenMock.mockClear();
  });

  it('maps typed methods to the correct command names and args', async () => {
    await nativeMonitorIpc.play();
    await nativeMonitorIpc.pause();
    await nativeMonitorIpc.seek(2.5);
    await nativeMonitorIpc.setCanvasSize(640, 360);
    await nativeMonitorIpc.setMode('canvas');
    await nativeMonitorIpc.setViewport({ x: 1, y: 2, width: 3, height: 4, visible: true });
    await nativeMonitorIpc.setAudioSettings({ bufferSize: 2048, backend: 'pulseaudio' });
    await nativeMonitorIpc.close();

    expect(invokeMock.mock.calls).toEqual([
      ['monitor_play'],
      ['monitor_pause'],
      ['monitor_seek', { timeSec: 2.5 }],
      ['monitor_set_canvas_size', { width: 640, height: 360 }],
      ['monitor_set_mode', { mode: 'canvas' }],
      ['monitor_set_viewport', { x: 1, y: 2, width: 3, height: 4, visible: true }],
      ['monitor_set_audio_settings', { bufferSize: 2048, backend: 'pulseaudio' }],
      ['monitor_close'],
    ]);
  });

  it('subscribes to typed events with the shared event names', async () => {
    await onMonitorTime(() => {});
    await onMonitorEnded(() => {});

    expect(listenMock.mock.calls[0]?.[0]).toBe(MONITOR_EVENTS.time);
    expect(listenMock.mock.calls[1]?.[0]).toBe(MONITOR_EVENTS.ended);
  });

  it('forwards the timeline-time payload to the handler', async () => {
    const handler = vi.fn();
    await onMonitorTime(handler);
    const registeredCb = listenMock.mock.calls[0]?.[1] as (e: { payload: number }) => void;
    registeredCb({ payload: 3.14 });
    expect(handler).toHaveBeenCalledWith(3.14);
  });
});

describe('toMonitorAudioSettingsPayload', () => {
  it('maps default audio settings to null native values', () => {
    expect(
      toMonitorAudioSettingsPayload({
        bufferSize: 'default',
        backend: 'default',
      }),
    ).toEqual({
      bufferSize: null,
      backend: null,
    });
  });

  it('keeps explicit native audio settings', () => {
    expect(
      toMonitorAudioSettingsPayload({
        bufferSize: 2048,
        backend: 'pulseaudio',
      }),
    ).toEqual({
      bufferSize: 2048,
      backend: 'pulseaudio',
    });
  });
});
