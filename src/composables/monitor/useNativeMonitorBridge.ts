import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { onScopeDispose, watch } from 'vue';

import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { isClipItem, isSourceClipItem, type TimelineClipItem } from '~/timeline/types';
import { createDevLogger } from '~/utils/dev-logger';
import { isTauriRuntime } from '~/utils/runtime';
import type { TauriDirectoryHandle } from '~/stores/workspace/provider/tauri-handle';

const log = createDevLogger('useNativeMonitorBridge');

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp']);

interface SceneLayer {
  id: string;
  kind: 'video' | 'image';
  path: string;
  timeline_start_sec: number;
  timeline_end_sec: number;
  source_start_sec: number;
  z: number;
  opacity: number;
}

interface MonitorScene {
  layers: SceneLayer[];
  width: number;
  height: number;
  /** Preview scale: 1 = full, 0.5 = 1/2, 0.25 = 1/4, 0.125 = 1/8. */
  preview_scale?: number;
}

function extOf(path: string): string {
  const i = path.lastIndexOf('.');
  return i >= 0 ? path.slice(i + 1) : '';
}

function isImageLayer(clip: TimelineClipItem): boolean {
  if (clip.isImage) return true;
  const path = clip.source?.path ?? '';
  return IMAGE_EXT.has(extOf(path).toLowerCase());
}

async function resolveProjectAbsolutePath(
  projectRelativePath: string,
  projectStore: ReturnType<typeof useProjectStore>,
): Promise<string> {
  try {
    const handle = await projectStore.getProjectDirHandle();
    const projectPath = (handle as unknown as TauriDirectoryHandle | null)?.path;
    if (!projectPath) return projectRelativePath;
    const { join } = await import('@tauri-apps/api/path');
    return await join(projectPath, projectRelativePath);
  } catch {
    return projectRelativePath;
  }
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

  let lastSceneJson = '';
  let suppressSeekFromTimeUpdate = false;

  async function buildScene(): Promise<MonitorScene> {
    const doc = timelineStore.timelineDoc;
    const fmt = timelineStore.timelineFormat;
    const sceneWidth = fmt?.width ?? 1920;
    const sceneHeight = fmt?.height ?? 1080;
    // Preview scale хранится на activeMonitor (1 / 0.5 / 0.25 / 0.125). Прокидываем в натив
    // для downscale на стороне ffmpeg — ключевая оптимизация для 4K source'ов.
    const previewScale = projectStore.activeMonitor?.previewResolution ?? 1;
    const layers: SceneLayer[] = [];
    if (!doc?.tracks?.length)
      return {
        layers,
        width: sceneWidth,
        height: sceneHeight,
        preview_scale: previewScale,
      };

    // В fastcat КОНВЕНЦИЯ: первый video-трек в `doc.tracks` = верхний визуально = должен
    // рисоваться поверх. Веб-композитор для этого даёт трекам `layer = N - 1 - index`
    // (см. `payloadBuilder.buildWorkerVideoTracks`). Зеркалим ту же арифметику здесь —
    // иначе layer'а 0 у image и video схлопывался в одинаковый z, и порядок отрисовки
    // случайно зависел от порядка обхода.
    const visibleVideoTracks = doc.tracks.filter(
      (track) => track.kind === 'video' && !track.videoHidden,
    );
    const videoTrackLayerById = new Map<string, number>();
    visibleVideoTracks.forEach((track, index) => {
      videoTrackLayerById.set(track.id, visibleVideoTracks.length - 1 - index);
    });

    for (const track of visibleVideoTracks) {
      if (!track?.items) continue;
      const trackLayer = videoTrackLayerById.get(track.id) ?? 0;
      for (const item of track.items) {
        if (!isClipItem(item) || !isSourceClipItem(item)) continue;
        if (item.disabled) continue;
        const path = item.source?.path;
        if (!path) continue;

        const absolutePath = await resolveProjectAbsolutePath(path, projectStore);
        const startUs = item.timelineRange.startUs;
        const durUs = item.timelineRange.durationUs;
        const srcStartUs = item.sourceRange.startUs;

        const opacityActive = item.opacityActive !== false;
        const opacity = opacityActive ? (item.opacity ?? 1) : 1;

        // z = track layer * 1000 + clip.layer (если задан) — клипы внутри трека
        // упорядочены по своему layer, а трек целиком — по своему.
        const clipLayer =
          typeof item.layer === 'number' && Number.isFinite(item.layer)
            ? Math.round(item.layer)
            : 0;
        const z = trackLayer * 1000 + clipLayer;

        layers.push({
          id: item.id,
          kind: isImageLayer(item) ? 'image' : 'video',
          path: absolutePath,
          timeline_start_sec: startUs / 1_000_000,
          timeline_end_sec: (startUs + durUs) / 1_000_000,
          source_start_sec: srcStartUs / 1_000_000,
          z,
          opacity: Math.max(0, Math.min(1, opacity)),
        });
      }
    }
    return { layers, width: sceneWidth, height: sceneHeight, preview_scale: previewScale };
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

  // Manual seek (только когда не играем — иначе натив сам тикает).
  watch(
    () => timelineStore.currentTime,
    async (t) => {
      if (timelineStore.isPlaying) return;
      if (suppressSeekFromTimeUpdate) return;
      try {
        await invoke('monitor_seek', { timeSec: t / 1_000_000 });
      } catch (err) {
        log.warn('monitor_seek failed', err);
      }
    },
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
