import { invoke } from '@tauri-apps/api/core';
import { computed, watch } from 'vue';

import { useTimelineStore } from '~/stores/timeline.store';
import {
  isClipItem,
  isSourceClipItem,
  type TimelineClipItem,
} from '~/timeline/types';
import { createDevLogger } from '~/utils/dev-logger';
import { isTauriRuntime } from '~/utils/runtime';

const log = createDevLogger('useNativeMonitorBridge');

/**
 * Привязка состояния таймлайна к нативному монитору (winit-окно + Vello-композитор в Rust).
 *
 * Минимальный baseline:
 *   - при playhead над media-клипом — открываем его исходник в нативном окне (lazy spawn);
 *   - `isPlaying` → `monitor_play` / `monitor_pause`;
 *   - на ручной seek (пауза) — мирорим playhead в clip-локальное время через `monitor_seek`.
 *
 * Адресовка времени: clip-local = clip.sourceRange.startUs + (playhead - clip.timelineRange.startUs).
 * Скорость воспроизведения, эффекты и многотрековая композиция пока ИГНОРИРУЮТСЯ — это
 * однопоточный baseline-плеер: один трек, один файл.
 */
export function useNativeMonitorBridge(): void {
  if (!isTauriRuntime()) return;

  const timelineStore = useTimelineStore();

  const activeMediaClip = computed<TimelineClipItem | null>(() => {
    const doc = timelineStore.timelineDoc;
    if (!doc?.tracks?.length) return null;
    const t = timelineStore.currentTime;
    // Идём по трекам сверху вниз (последний в массиве — верхний слой).
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

  // Открываем новый клип в нативном окне при смене источника.
  watch(
    () => activeMediaClip.value?.source?.path ?? null,
    async (path) => {
      if (!path) return;
      try {
        await invoke('monitor_open', { path });
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
      if (!activeMediaClip.value) return;
      try {
        await invoke(playing ? 'monitor_play' : 'monitor_pause');
      } catch (err) {
        log.warn('monitor play/pause failed', err);
      }
    },
  );

  // Seek: пробрасываем только когда таймлайн НЕ играет — во время play
  // натив сам тикает кадры, и постоянный seek приведёт к рестарту pipeline.
  watch(
    () => timelineStore.currentTime,
    async (t) => {
      if (timelineStore.isPlaying) return;
      const clip = activeMediaClip.value;
      if (!clip) return;
      try {
        await invoke('monitor_seek', { timeSec: clipLocalSec(t, clip) });
      } catch (err) {
        log.warn('monitor_seek failed', err);
      }
    },
  );
}
