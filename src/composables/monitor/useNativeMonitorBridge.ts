import type { UnlistenFn } from '@tauri-apps/api/event';
import { onScopeDispose, watch } from 'vue';
import { nativeMonitorIpc, onMonitorTime, onMonitorEnded } from './native-monitor-ipc';

import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import type { TimelineDocument, TimelineTrack } from '~/timeline/types';
import { createDevLogger } from '~/utils/dev-logger';
import { isTauriRuntime } from '~/utils/runtime';
import { buildNativeMonitorScene, type NativeMonitorScene } from '~/utils/native-monitor-scene';
import {
  isNativeMonitorDisabled,
  markNativeMonitorInitFailure,
} from '~/composables/monitor/native-monitor-availability';

const log = createDevLogger('useNativeMonitorBridge');

interface NativeAudioTrackSelection {
  hasAudioSolo: boolean;
  videoTracksForAudio: TimelineTrack[];
  audioTracksForAudio: TimelineTrack[];
}

const NATIVE_TIME_STORE_SYNC_MS = 50;
// Во время воспроизведения мелкие правки currentTime (в пределах этого окна) считаем
// шумом локального тика, а не реальным seek'ом — иначе натив дёргался бы на каждый тик
// мастер-клока. Крупные прыжки (drag playhead) — реальная перемотка.
const PLAYING_SEEK_IGNORE_US = 200_000;

export function isNativeMonitorSceneReady(params: {
  currentProjectName: string | null;
  currentTimelinePath: string | null;
  timelineDoc: TimelineDocument | null;
}): boolean {
  return Boolean(params.currentProjectName && params.currentTimelinePath && params.timelineDoc);
}

export function shouldSyncNativeMonitorTime(params: {
  diffUs: number;
  nowMs: number;
  lastSyncMs: number;
}): boolean {
  if (params.diffUs < 500) return false;
  if (params.diffUs > 100_000) return true;
  return params.nowMs - params.lastSyncMs >= NATIVE_TIME_STORE_SYNC_MS;
}

export function resolveNativeAudioTrackSelection(params: {
  visibleVideoTracks: TimelineTrack[];
  audioTracks: TimelineTrack[];
}): NativeAudioTrackSelection {
  const hasAudioSolo = [...params.visibleVideoTracks, ...params.audioTracks].some((track) =>
    Boolean(track.audioSolo),
  );

  return {
    hasAudioSolo,
    videoTracksForAudio: hasAudioSolo
      ? params.visibleVideoTracks.filter((track) => Boolean(track.audioSolo))
      : params.visibleVideoTracks.filter((track) => !track.audioMuted),
    audioTracksForAudio: hasAudioSolo
      ? params.audioTracks.filter((track) => Boolean(track.audioSolo))
      : params.audioTracks.filter((track) => !track.audioMuted),
  };
}

/**
 * Привязка таймлайна к нативному мульти-слойному монитору.
 *
 *   - сцена = снапшот всех video/image клипов; z = trackIndex (выше — поверх);
 *   - opacity = clip.opacity * (1 - transitions/masks?), пока берём только per-clip opacity;
 *   - на каждое значимое изменение шлём `monitor_set_scene`;
 *   - транспорт (play/pause/seek) — отдельные команды по timeline-PTS;
 *   - master clock — натив, эмитит timeline-time в `monitor:time`.
 */
export function useNativeMonitorBridge(): void {
  if (!isTauriRuntime()) return;

  const timelineStore = useTimelineStore();
  const projectStore = useProjectStore();
  const workspaceStore = useWorkspaceStore();

  let lastSceneJson = '';
  let suppressSeekFromTimeUpdate = false;
  let lastSentTime = 0;
  let lastNativeTimeStoreSyncMs = 0;
  // Монотонный токен сборки сцены: buildScene() — async, и без него медленная сборка,
  // стартовавшая раньше, могла бы завершиться позже и отправить устаревшую сцену поверх свежей.
  let sceneBuildSeq = 0;

  function warnMonitorFailure(message: string, err: unknown): void {
    const disabledNow = markNativeMonitorInitFailure(err);
    if (disabledNow || !isNativeMonitorDisabled()) {
      log.warn(message, err);
    }
  }

  async function buildScene(): Promise<NativeMonitorScene> {
    const doc = timelineStore.timelineDoc;
    const previewScale = projectStore.activeMonitor?.previewResolution ?? 1;
    if (!doc?.tracks?.length) {
      const fmt = timelineStore.timelineFormat;
      return {
        layers: [],
        audio_layers: [],
        audio_tracks: [],
        audio_master_gain: Math.max(0, Number(timelineStore.masterGain ?? 1)),
        audio_master_muted: Boolean(timelineStore.audioMuted),
        width: fmt?.width ?? 1920,
        height: fmt?.height ?? 1080,
        preview_scale: previewScale,
        preview_fps: fmt?.fps ?? 30,
        preview_sync_mode: workspaceStore.userSettings.optimization.nativeMonitorSyncMode,
      };
    }

    return await buildNativeMonitorScene({
      timelineDoc: doc,
      projectStore,
      workspaceStore,
      masterGain: timelineStore.masterGain,
      masterMuted: timelineStore.audioMuted,
      previewScale,
      fallbackFormat: timelineStore.timelineFormat,
    });
  }

  async function syncScene(): Promise<void> {
    const seq = ++sceneBuildSeq;
    try {
      if (
        !isNativeMonitorSceneReady({
          currentProjectName: projectStore.currentProjectName,
          currentTimelinePath: projectStore.currentTimelinePath,
          timelineDoc: timelineStore.timelineDoc,
        })
      ) {
        return;
      }
      const scene = await buildScene();
      // Более новая сборка обогнала нас — выходим, чтобы не затереть свежую сцену.
      if (seq !== sceneBuildSeq) return;
      if (isNativeMonitorDisabled()) return;
      const json = JSON.stringify(scene);
      if (json === lastSceneJson) return;
      lastSceneJson = json;
      await nativeMonitorIpc.setScene(scene);
    } catch (err) {
      warnMonitorFailure('monitor_set_scene failed', err);
    }
  }

  watch(
    () => ({
      bufferSize: workspaceStore.userSettings.audioEngine.bufferSize,
      backend: workspaceStore.userSettings.audioEngine.backend,
    }),
    (settings) => {
      if (isNativeMonitorDisabled()) return;
      void nativeMonitorIpc
        .setAudioSettings(settings)
        .catch((err) => warnMonitorFailure('monitor_set_audio_settings failed', err));
    },
    { immediate: true },
  );

  // Сцена меняется при правках треков/клипов и формата.
  // Наблюдаем только tracks + format (не весь doc), чтобы не гонять IPC на каждое
  // изменение waveform-данных или UI-полей, не влияющих на рендер.
  watch(
    [
      () => timelineStore.timelineDoc?.tracks,
      () => timelineStore.timelineFormat,
      () => timelineStore.masterGain,
      () => timelineStore.audioMuted,
      () => projectStore.activeMonitor?.previewResolution,
      () => workspaceStore.userSettings.optimization.nativeMonitorSyncMode,
    ],
    () => {
      void syncScene();
    },
    { deep: true, immediate: true },
  );

  // Play/Pause.
  watch(
    () => timelineStore.isPlaying,
    async (playing) => {
      if (isNativeMonitorDisabled()) return;
      try {
        await (playing ? nativeMonitorIpc.play() : nativeMonitorIpc.pause());
      } catch (err) {
        warnMonitorFailure('monitor play/pause failed', err);
      }
    },
  );

  // Manual seek (когда не подавлено апдейтом от натива).
  let seekThrottleId: ReturnType<typeof setTimeout> | null = null;
  let pendingSeekTimeSec = 0;

  watch(
    () => timelineStore.currentTime,
    async (t) => {
      if (suppressSeekFromTimeUpdate) {
        lastSentTime = t;
        return;
      }

      if (timelineStore.isPlaying) {
        const diff = Math.abs(t - lastSentTime);
        if (diff <= PLAYING_SEEK_IGNORE_US) {
          return;
        }
      }

      lastSentTime = t;
      if (isNativeMonitorDisabled()) return;

      pendingSeekTimeSec = t / 1_000_000;
      if (seekThrottleId) {
        clearTimeout(seekThrottleId);
      }
      seekThrottleId = setTimeout(() => {
        seekThrottleId = null;
        void nativeMonitorIpc.seek(pendingSeekTimeSec).catch((err) => {
          warnMonitorFailure('monitor_seek failed', err);
        });
      }, 16);
    },
    { flush: 'sync' },
  );

  // Натив — мастер-клок: timeline-PTS (секунды) приходят в `monitor:time`.
  const unsubs: UnlistenFn[] = [];
  void onMonitorTime((timelineSec) => {
    const timelineUs = Math.round(timelineSec * 1_000_000);
    const diffUs = Math.abs(timelineUs - timelineStore.currentTime);
    const nowMs = performance.now();
    if (
      !shouldSyncNativeMonitorTime({
        diffUs,
        nowMs,
        lastSyncMs: lastNativeTimeStoreSyncMs,
      })
    ) {
      return;
    }

    lastNativeTimeStoreSyncMs = nowMs;
    suppressSeekFromTimeUpdate = true;
    timelineStore.currentTime = timelineUs;
    queueMicrotask(() => {
      suppressSeekFromTimeUpdate = false;
    });
  })
    .then((un) => unsubs.push(un))
    .catch((err) => log.warn('listen monitor:time failed', err));

  void onMonitorEnded(() => {
    if (timelineStore.isPlaying) timelineStore.isPlaying = false;
  })
    .then((un) => unsubs.push(un))
    .catch((err) => log.warn('listen monitor:ended failed', err));

  onScopeDispose(() => {
    for (const un of unsubs) un();
    if (!isNativeMonitorDisabled()) {
      void nativeMonitorIpc
        .close()
        .catch((err) => warnMonitorFailure('monitor_close on dispose failed', err));
    }
  });
}
