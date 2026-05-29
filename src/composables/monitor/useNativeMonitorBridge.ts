import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { computed, onScopeDispose, watch } from 'vue';

import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { isClipItem, isSourceClipItem, type TimelineClipItem } from '~/timeline/types';
import { createDevLogger } from '~/utils/dev-logger';
import { isTauriRuntime } from '~/utils/runtime';
import type { TauriDirectoryHandle } from '~/stores/workspace/provider/tauri-handle';

const log = createDevLogger('useNativeMonitorBridge');

/**
 * Привязка состояния таймлайна к нативному монитору (winit + Vello + ffmpeg в Rust).
 *
 * Baseline (single-clip):
 *   - playhead над media-клипом → открываем исходник в нативном окне (lazy spawn);
 *   - playhead вышел из любого клипа → пауза;
 *   - isPlaying → monitor_play / monitor_pause;
 *   - ручной seek (пауза) → monitor_seek в clip-local;
 *   - натив эмитит "monitor:time" → апдейтим timelineStore.currentTime (master clock — натив).
 *
 * Адресовка: clip-local_us = clip.sourceRange.startUs + (playhead_us − clip.timelineRange.startUs).
 * Скорость, эффекты, multi-track — пока игнорим.
 */
async function resolveClipAbsolutePath(
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

export function useNativeMonitorBridge(): void {
  if (!isTauriRuntime()) return;

  const timelineStore = useTimelineStore();
  const projectStore = useProjectStore();

  const activeMediaClip = computed<TimelineClipItem | null>(() => {
    const doc = timelineStore.timelineDoc;
    if (!doc?.tracks?.length) return null;
    const t = timelineStore.currentTime;
    for (let i = doc.tracks.length - 1; i >= 0; i--) {
      const track = doc.tracks[i];
      if (!track?.items) continue;
      for (const item of track.items) {
        if (!isClipItem(item) || !isSourceClipItem(item)) continue;
        if (!item.source?.path) continue;
        const start = item.timelineRange.startUs;
        const end = start + item.timelineRange.durationUs;
        if (t >= start && t < end) return item;
      }
    }
    return null;
  });

  function clipLocalSec(timelineTimeUs: number, clip: TimelineClipItem): number {
    const local = clip.sourceRange.startUs + (timelineTimeUs - clip.timelineRange.startUs);
    return Math.max(0, local) / 1_000_000;
  }

  let lastOpenedPath: string | null = null;
  // Когда натив сам тикает время и шлёт нам обновления, watch на currentTime
  // не должен реагировать форвардом обратно в monitor_seek.
  let suppressSeekFromTimeUpdate = false;

  // Открытие при смене источника + дедуп по path.
  watch(
    () => activeMediaClip.value?.source?.path ?? null,
    async (path) => {
      if (!path) {
        // Вышли из клипа — пауза, чтобы натив не доигрывал хвост.
        try {
          await invoke('monitor_pause');
        } catch (err) {
          log.warn('monitor_pause on clip exit failed', err);
        }
        return;
      }
      if (path === lastOpenedPath) return;
      lastOpenedPath = path;
      try {
        const absolutePath = await resolveClipAbsolutePath(path, projectStore);
        await invoke('monitor_open', { path: absolutePath });
        const clip = activeMediaClip.value;
        if (clip) {
          await invoke('monitor_seek', {
            timeSec: clipLocalSec(timelineStore.currentTime, clip),
          });
        }
        if (timelineStore.isPlaying) await invoke('monitor_play');
      } catch (err) {
        log.warn('monitor_open failed', err);
      }
    },
    { immediate: true },
  );

  // Play / Pause.
  watch(
    () => timelineStore.isPlaying,
    async (playing) => {
      if (!activeMediaClip.value) {
        if (!playing) {
          try {
            await invoke('monitor_pause');
          } catch (err) {
            log.warn('monitor pause failed', err);
          }
        }
        return;
      }
      try {
        await invoke(playing ? 'monitor_play' : 'monitor_pause');
      } catch (err) {
        log.warn('monitor play/pause failed', err);
      }
    },
  );

  // Ручной seek — только когда таймлайн НЕ играет (во время play натив сам тикает кадры
  // и postback из "monitor:time" не должен снова дёргать monitor_seek).
  watch(
    () => timelineStore.currentTime,
    async (t) => {
      if (timelineStore.isPlaying) return;
      if (suppressSeekFromTimeUpdate) return;
      const clip = activeMediaClip.value;
      if (!clip) return;
      try {
        await invoke('monitor_seek', { timeSec: clipLocalSec(t, clip) });
      } catch (err) {
        log.warn('monitor_seek failed', err);
      }
    },
  );

  // Master clock: натив каждые ~кадр шлёт текущий clip-local PTS.
  // Конвертим обратно в timeline-time и обновляем стор без обратного seek'а.
  const unsubs: UnlistenFn[] = [];
  void listen<number>('monitor:time', (event) => {
    const clip = activeMediaClip.value;
    if (!clip) return;
    const clipLocalUs = Math.round(event.payload * 1_000_000);
    const timelineUs = clip.timelineRange.startUs + (clipLocalUs - clip.sourceRange.startUs);
    const clampedEnd = clip.timelineRange.startUs + clip.timelineRange.durationUs;
    const next = Math.min(clampedEnd, Math.max(clip.timelineRange.startUs, timelineUs));
    if (Math.abs(next - timelineStore.currentTime) < 500) return; // < 0.5ms — шум
    suppressSeekFromTimeUpdate = true;
    timelineStore.currentTime = next;
    queueMicrotask(() => {
      suppressSeekFromTimeUpdate = false;
    });
    // Достигли конца клипа — паузим (натив тоже может прислать ended, но дублировать ок).
    if (next >= clampedEnd - 1 && timelineStore.isPlaying) {
      timelineStore.isPlaying = false;
    }
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
  });
}
