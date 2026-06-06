import type { Channel } from '@tauri-apps/api/core';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { NativeMonitorScene } from '~/utils/native-monitor-scene';
import type { MonitorMode } from '~/composables/monitor/useNativeMonitorMode';

/**
 * Single typed boundary for the native (Rust/winit/Vello) monitor window.
 *
 * Every `monitor_*` Tauri command and every `monitor:*` event flows through
 * here, so command names are declared once and argument/payload shapes are
 * type-checked at the call site instead of being stringly-typed `invoke(...)`
 * scattered across composables. The Rust counterparts live in
 * `src-tauri/src/ipc/monitor_cmd.rs`; keep the two in sync.
 */

export const MONITOR_EVENTS = {
  /** Native master clock: current timeline PTS in seconds. */
  time: 'monitor:time',
  /** Playback reached the end of the timeline. */
  ended: 'monitor:ended',
} as const;

export interface MonitorViewportArgs {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}

export interface MonitorAudioSettingsInput {
  bufferSize: 'default' | number;
  backend: 'default' | string;
}

export interface MonitorAudioSettingsPayload extends Record<string, unknown> {
  bufferSize: number | null;
  backend: string | null;
}

export function toMonitorAudioSettingsPayload(
  settings: MonitorAudioSettingsInput,
): MonitorAudioSettingsPayload {
  return {
    bufferSize: settings.bufferSize === 'default' ? null : settings.bufferSize,
    backend: settings.backend === 'default' ? null : settings.backend,
  };
}

export const nativeMonitorIpc = {
  /** Push the current timeline snapshot (video + audio layers) to the window. */
  setScene(scene: NativeMonitorScene): Promise<void> {
    return invoke('monitor_set_scene', { scene });
  },
  play(): Promise<void> {
    return invoke('monitor_play');
  },
  pause(): Promise<void> {
    return invoke('monitor_pause');
  },
  /** Seek by timeline PTS in seconds. */
  seek(timeSec: number): Promise<void> {
    return invoke('monitor_seek', { timeSec });
  },
  /** Position/size of the embedded child window, physical pixels. */
  setViewport(args: MonitorViewportArgs): Promise<void> {
    const { x, y, width, height, visible } = args;
    return invoke('monitor_set_viewport', { x, y, width, height, visible });
  },
  /** Switch output between embedded child window and offscreen canvas stream. */
  setMode(mode: MonitorMode): Promise<void> {
    return invoke('monitor_set_mode', { mode });
  },
  /** Subscribe to the RGBA frame stream (canvas mode). */
  subscribeFrames(channel: Channel<ArrayBuffer>): Promise<void> {
    return invoke('monitor_subscribe_frames', { channel });
  },
  /** Render-target size in canvas mode, physical pixels. */
  setCanvasSize(width: number, height: number): Promise<void> {
    return invoke('monitor_set_canvas_size', { width, height });
  },
  setAudioSettings(settings: MonitorAudioSettingsInput): Promise<void> {
    return invoke('monitor_set_audio_settings', toMonitorAudioSettingsPayload(settings));
  },
  close(): Promise<void> {
    return invoke('monitor_close');
  },
} as const;

/** Subscribe to native timeline-time ticks (seconds). */
export function onMonitorTime(handler: (timelineSec: number) => void): Promise<UnlistenFn> {
  return listen<number>(MONITOR_EVENTS.time, (event) => handler(event.payload));
}

/** Subscribe to the native playback-ended event. */
export function onMonitorEnded(handler: () => void): Promise<UnlistenFn> {
  return listen(MONITOR_EVENTS.ended, () => handler());
}
