import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { onScopeDispose, watch } from 'vue';

import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import type { TimelineTrack } from '~/timeline/types';
import { createDevLogger } from '~/utils/dev-logger';
import { isTauriRuntime } from '~/utils/runtime';
import { buildNativeMonitorScene, type NativeMonitorScene } from '~/utils/native-monitor-scene';

const log = createDevLogger('useNativeMonitorBridge');

interface NativeAudioTrackSelection {
  hasAudioSolo: boolean;
  videoTracksForAudio: TimelineTrack[];
  audioTracksForAudio: TimelineTrack[];
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
    try {
      const scene = await buildScene();
      const json = JSON.stringify(scene);
      if (json === lastSceneJson) return;
      lastSceneJson = json;
      await invoke('monitor_set_scene', { scene });
    } catch (err) {
      log.warn('monitor_set_scene failed', err);
    }
  }

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
      try {
        await invoke(playing ? 'monitor_play' : 'monitor_pause');
      } catch (err) {
        log.warn('monitor play/pause failed', err);
      }
    },
  );

  // Manual seek (когда не подавлено апдейтом от натива).
  watch(
    () => timelineStore.currentTime,
    async (t) => {
      if (suppressSeekFromTimeUpdate) {
        lastSentTime = t;
        return;
      }

      if (timelineStore.isPlaying) {
        const diff = Math.abs(t - lastSentTime);
        if (diff <= 200_000) {
          return;
        }
      }

      lastSentTime = t;
      try {
        await invoke('monitor_seek', { timeSec: t / 1_000_000 });
      } catch (err) {
        log.warn('monitor_seek failed', err);
      }
    },
    { flush: 'sync' },
  );

  // Натив — мастер-клок: timeline-PTS (секунды) приходят в `monitor:time`.
  const unsubs: UnlistenFn[] = [];
  void listen<number>('monitor:time', (event) => {
    const timelineUs = Math.round(event.payload * 1_000_000);
    if (Math.abs(timelineUs - timelineStore.currentTime) < 500) return;
    suppressSeekFromTimeUpdate = true;
    timelineStore.currentTime = timelineUs;
    queueMicrotask(() => {
      suppressSeekFromTimeUpdate = false;
    });
  })
    .then((un) => unsubs.push(un))
    .catch((err) => log.warn('listen monitor:time failed', err));

  void listen('monitor:ended', () => {
    if (timelineStore.isPlaying) timelineStore.isPlaying = false;
  })
    .then((un) => unsubs.push(un))
    .catch((err) => log.warn('listen monitor:ended failed', err));

  onScopeDispose(() => {
    for (const un of unsubs) un();
    void invoke('monitor_close').catch((err) => log.warn('monitor_close on dispose failed', err));
  });
}
