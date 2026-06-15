import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { computed, onScopeDispose, watch } from 'vue';
import {
  nativeMonitorIpc,
  onMonitorTime,
  onMonitorEnded,
  MONITOR_EVENTS,
  type MonitorAudioSettingsInput,
} from './native-monitor-ipc';

import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProxyStore } from '~/stores/proxy.store';
import type { TimelineDocument, TimelineTrack } from '~/timeline/types';
import { createDevLogger } from '~/utils/dev-logger';
import { isTauriRuntime } from '~/utils/runtime';
import { buildNativeMonitorScene, type NativeMonitorScene } from '~/utils/native-monitor-scene';
import {
  isNativeMonitorDisabled,
  markNativeMonitorInitFailure,
  resetNativeMonitorAvailability,
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

export async function syncNativeMonitorTransportAfterScene(params: {
  isPlaying: boolean;
  isNativeMonitorDisabled: () => boolean;
  pause: () => Promise<void>;
  warnFailure: (message: string, err: unknown) => void;
}): Promise<void> {
  if (params.isPlaying || params.isNativeMonitorDisabled()) return;

  try {
    await params.pause();
  } catch (err) {
    params.warnFailure('monitor pause after scene sync failed', err);
  }
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

  const route = useRoute();
  const isMobile = computed(() => route.path.startsWith('/m'));

  const timelineStore = useTimelineStore();
  const projectStore = useProjectStore();
  const workspaceStore = useWorkspaceStore();
  const proxyStore = useProxyStore();

  let lastSceneJson = '';
  let suppressSeekFromTimeUpdate = false;
  let lastNativeTimeStoreSyncMs = 0;
  let disposed = false;
  // Expected-playback-position anchor. The native engine is the master clock but
  // only emits `monitor:time` a handful of times per second; the timeline store
  // interpolates its own smooth playhead in between. Comparing currentTime to a
  // stale `lastSentTime` made that interpolation drift past the ignore window and
  // echo back as a `monitor_seek` ~5×/s, which wiped the native audio prebuffer
  // and reset its decoders every time (constant crackle, monitor stuck ~9fps).
  // Instead we anchor to the last authoritative native time + wall clock and only
  // treat a currentTime change as a real seek when it deviates from where playback
  // SHOULD be by now. Re-pinned on every native sync so drift can't accumulate.
  let playbackAnchorUs = 0;
  let playbackAnchorWallMs = 0;
  // True from the moment Play is requested until the native engine confirms it
  // actually started (first `monitor:time`). The native side defers the start
  // while it warms decoders (prebuffer, up to ~1.5s on a cold 4K GOP), so the
  // wall-clock anchor seeded at the click runs ahead of the real native clock.
  // During this window a currentTime change must NOT be read as a seek — otherwise
  // the first native time (arriving "from the past") looks like a backward jump and
  // gets echoed as a `monitor_seek`, which reseeks the audio engine and replays the
  // first fraction of a second (the "audio plays twice" on 4K). Cleared on the
  // first native sync, after which the normal anchor-deviation logic takes over.
  let awaitingFirstNativeTime = false;
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
        audio_master_effects: [],
        width: fmt?.width ?? 1920,
        height: fmt?.height ?? 1080,
        preview_scale: previewScale,
        preview_fps: fmt?.fps ?? 30,
        preview_sync_mode: isMobile.value
          ? 'balanced'
          : workspaceStore.userSettings.optimization.nativeMonitorSyncMode,
        frame_cache_mode: workspaceStore.userSettings.optimization.nativeFrameCacheMode,
        frame_cache_custom_mb: Math.max(
          0,
          Math.round(workspaceStore.userSettings.optimization.nativeFrameCacheCustomMb),
        ),
        master_effects: [],
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
      useProxyInMonitor: projectStore.activeMonitor?.useProxy !== false,
      existingProxies: proxyStore.existingProxies,
      getProxyNativePath: proxyStore.getProxyNativePath,
      syncMode: isMobile.value ? 'balanced' : undefined,
    });
  }

  async function syncScene(): Promise<void> {
    const seq = ++sceneBuildSeq;
    try {
      if (disposed) return;
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
      if (disposed || seq !== sceneBuildSeq) return;
      if (isNativeMonitorDisabled()) return;
      const json = JSON.stringify(scene);
      if (json === lastSceneJson) return;
      lastSceneJson = json;
      await nativeMonitorIpc.setScene(scene);
      await syncNativeMonitorTransportAfterScene({
        isPlaying: timelineStore.isPlaying,
        isNativeMonitorDisabled,
        pause: () => nativeMonitorIpc.pause(),
        warnFailure: warnMonitorFailure,
      });
    } catch (err) {
      warnMonitorFailure('monitor_set_scene failed', err);
    }
  }

  watch(
    () => ({
      experimentalFeatures: workspaceStore.userSettings.experimentalFeatures,
      bufferSize: workspaceStore.userSettings.audioEngine.bufferSize,
      backend: workspaceStore.userSettings.audioEngine.backend,
    }),
    ({ experimentalFeatures, bufferSize, backend }) => {
      if (isNativeMonitorDisabled()) return;
      const settings: MonitorAudioSettingsInput = experimentalFeatures
        ? { bufferSize: bufferSize as 'default' | number, backend: backend as 'default' | string }
        : { bufferSize: 'default', backend: 'default' };
      void nativeMonitorIpc
        .setAudioSettings(settings)
        .catch((err) => warnMonitorFailure('monitor_set_audio_settings failed', err));
    },
    { immediate: true },
  );

  // When the project changes, clear the disabled flag so subsequent scene syncs
  // can reach the monitor.  We do NOT reset the Rust monitor handle — winit on
  // Linux allows only one EventLoop per process, so respawning always fails with
  // "EventLoop can't be recreated".  The monitor thread lives for the app session.
  watch(
    () => projectStore.currentProjectName,
    async () => {
      if (isNativeMonitorDisabled()) {
        log.info('[bridge] clearing disabled flag on project change');
        resetNativeMonitorAvailability();
      }
    },
  );

  // Use computed refs for doc-derived arrays so the watcher only fires when the
  // array *contents* mutate, not when the parent doc object is replaced (e.g.
  // update_master_gain replaces timelineDoc but preserves the tracks reference).
  const nativeMonitorTracks = computed(() => timelineStore.timelineDoc?.tracks ?? []);
  const nativeMonitorMasterEffects = computed(
    () => timelineStore.timelineDoc?.metadata?.fastcat?.masterEffects ?? [],
  );

  let sceneSyncDebounceTimer: number | null = null;

  function scheduleSyncScene(delayMs = 100): void {
    if (sceneSyncDebounceTimer !== null) {
      clearTimeout(sceneSyncDebounceTimer);
    }
    sceneSyncDebounceTimer = window.setTimeout(() => {
      sceneSyncDebounceTimer = null;
      void syncScene();
    }, delayMs);
  }

  // Сцена меняется при правках треков/клипов и формата.
  // Наблюдаем только tracks + format (не весь doc), чтобы не гонять IPC на каждое
  // изменение waveform-данных или UI-полей, не влияющих на рендер.
  watch(
    [
      nativeMonitorTracks,
      () => timelineStore.timelineFormat,
      () => projectStore.activeMonitor?.previewResolution,
      () => projectStore.activeMonitor?.useProxy,
      () => proxyStore.existingProxies,
      () => workspaceStore.userSettings.optimization.nativeMonitorSyncMode,
      nativeMonitorMasterEffects,
    ],
    () => {
      void syncScene();
    },
    { deep: true, immediate: true },
  );

  // Master gain/muted — debounced to avoid a scene-rebuild storm during drag.
  // The WebAudio engine already reacts instantly via the monitor-core wiring,
  // so a small delay for the native monitor scene is imperceptible.
  watch(
    [() => timelineStore.masterGain, () => timelineStore.audioMuted],
    () => {
      scheduleSyncScene(100);
    },
    { immediate: true },
  );

  // Play/Pause.
  watch(
    () => timelineStore.isPlaying,
    async (playing) => {
      if (playing) {
        // Seed the expected-position anchor at the moment playback starts so the
        // first local ticks (before any native `monitor:time` arrives) are judged
        // as normal progression, not seeks.
        playbackAnchorUs = timelineStore.currentTime;
        playbackAnchorWallMs = performance.now();
        // Native start is deferred until decoders warm up; suppress seek-detection
        // until it confirms by emitting the first `monitor:time` (see flag docs).
        awaitingFirstNativeTime = true;
      } else {
        awaitingFirstNativeTime = false;
      }
      if (isNativeMonitorDisabled()) return;
      try {
        await (playing ? nativeMonitorIpc.play() : nativeMonitorIpc.pause());
      } catch (err) {
        warnMonitorFailure('monitor play/pause failed', err);
      }
    },
  );

  // Глобальная скорость воспроизведения (мультипликатор таймлайн-времени). Натив —
  // мастер-клок, он сам разгоняет/тормозит/реверсирует время и аудио по этой команде.
  // immediate: держим нативную скорость в синхроне с момента маунта (даже на паузе),
  // чтобы старт воспроизведения сразу шёл на нужной скорости.
  watch(
    () => timelineStore.playbackSpeed,
    (speed) => {
      // Re-pin the expected-position anchor: a speed change re-bases how fast the
      // playhead is expected to move, otherwise the seek watcher below would read
      // the next local tick as a jump and echo a spurious seek.
      playbackAnchorUs = timelineStore.currentTime;
      playbackAnchorWallMs = performance.now();
      if (isNativeMonitorDisabled()) return;
      const s = Number(speed);
      void nativeMonitorIpc
        .setSpeed(Number.isFinite(s) && s !== 0 ? s : 1)
        .catch((err) => warnMonitorFailure('monitor_set_speed failed', err));
    },
    { immediate: true },
  );

  // Manual seek (когда не подавлено апдейтом от натива).
  let seekThrottleId: ReturnType<typeof setTimeout> | null = null;
  let pendingSeekTimeSec = 0;

  watch(
    () => timelineStore.currentTime,
    async (t) => {
      if (suppressSeekFromTimeUpdate) {
        return;
      }

      if (timelineStore.isPlaying) {
        // Native hasn't confirmed playback start yet (still warming decoders): the
        // wall anchor seeded at the click is ahead of the real (not-yet-running)
        // native clock, so any currentTime change here would be misread as a seek
        // and echoed back as a spurious backward seek. Don't seek until the first
        // native time arrives (which clears this flag and re-pins the anchor).
        if (awaitingFirstNativeTime) {
          return;
        }
        // Where playback should be by now, extrapolated from the last native
        // (master-clock) anchor at the current playback speed (negative = reverse).
        // Local interpolation that simply follows the master clock stays within the
        // window → NOT a seek. A genuine scrub jumps off this trajectory and exceeds
        // the window → real seek.
        const speed = Number.isFinite(timelineStore.playbackSpeed)
          ? timelineStore.playbackSpeed
          : 1;
        const expectedUs =
          playbackAnchorUs + (performance.now() - playbackAnchorWallMs) * 1000 * speed;
        if (Math.abs(t - expectedUs) <= PLAYING_SEEK_IGNORE_US) {
          return;
        }
      }

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
    if (disposed) return;
    const timelineUs = Math.round(timelineSec * 1_000_000);
    const diffUs = Math.abs(timelineUs - timelineStore.currentTime);
    const nowMs = performance.now();
    // Any native time means playback actually started — clear the deferred-start
    // guard up front, even when the sync itself is throttled below (the first tick
    // is often within the sync threshold of currentTime), so seek-detection isn't
    // suppressed for the rest of the session.
    if (awaitingFirstNativeTime) {
      awaitingFirstNativeTime = false;
      playbackAnchorUs = timelineUs;
      playbackAnchorWallMs = nowMs;
    }
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
    // Re-pin the expected-position anchor to the authoritative native time so the
    // seek watcher's extrapolation tracks the master clock and never drifts into
    // a spurious echo-seek.
    playbackAnchorUs = timelineUs;
    playbackAnchorWallMs = nowMs;
    suppressSeekFromTimeUpdate = true;
    timelineStore.currentTime = timelineUs;
    queueMicrotask(() => {
      suppressSeekFromTimeUpdate = false;
    });
  })
    .then((un) => {
      if (disposed) {
        un();
        return;
      }
      unsubs.push(un);
    })
    .catch((err) => log.warn('listen monitor:time failed', err));

  void onMonitorEnded(() => {
    if (disposed) return;
    if (timelineStore.isPlaying) timelineStore.isPlaying = false;
  })
    .then((un) => {
      if (disposed) {
        un();
        return;
      }
      unsubs.push(un);
    })
    .catch((err) => log.warn('listen monitor:ended failed', err));

  void listen<import('~/utils/video-editor/TauriAudioEngine').NativeAudioLevelsPayload>(
    MONITOR_EVENTS.audioLevels,
    (event) => {
      if (disposed) return;
      const payload = event.payload;
      if (!payload) return;

      const nextLevels = { ...timelineStore.audioLevels };
      nextLevels.master = {
        rmsDb: Number.isFinite(payload.rmsDb) ? payload.rmsDb : -60,
        peakDb: Number.isFinite(payload.peakDb) ? payload.peakDb : -60,
      };

      if (payload.tracks) {
        for (const [trackId, trackLevels] of Object.entries(payload.tracks)) {
          const trL = trackLevels as { rmsDb: number; peakDb: number };
          nextLevels[trackId] = {
            rmsDb: Number.isFinite(trL.rmsDb) ? trL.rmsDb : -60,
            peakDb: Number.isFinite(trL.peakDb) ? trL.peakDb : -60,
          };
        }
      }

      timelineStore.audioLevels = nextLevels;
    },
  )
    .then((un) => {
      if (disposed) {
        un();
        return;
      }
      unsubs.push(un);
    })
    .catch((err) => log.warn('listen monitor:audio-levels failed', err));

  onScopeDispose(() => {
    disposed = true;
    for (const un of unsubs) un();
    unsubs.length = 0;
    if (sceneSyncDebounceTimer !== null) {
      clearTimeout(sceneSyncDebounceTimer);
      sceneSyncDebounceTimer = null;
    }
    if (seekThrottleId) {
      clearTimeout(seekThrottleId);
      seekThrottleId = null;
    }
    if (!isNativeMonitorDisabled()) {
      // Pause playback and clear the scene to free resources, but do NOT close/kill the EventLoop
      // since winit EventLoop cannot be recreated in the same process on Linux.
      void nativeMonitorIpc
        .pause()
        .catch((err) => log.warn('monitor pause on dispose failed', err));
      void nativeMonitorIpc
        .setScene({
          layers: [],
          audio_layers: [],
          audio_tracks: [],
          audio_master_gain: 0,
          audio_master_muted: true,
          audio_master_effects: [],
          width: 1920,
          height: 1080,
          preview_scale: 1,
          preview_fps: 30,
          preview_sync_mode: 'balanced',
          frame_cache_mode: 'auto',
          frame_cache_custom_mb: 0,
          master_effects: [],
        })
        .catch((err) => log.warn('monitor clear scene on dispose failed', err));
      void nativeMonitorIpc
        .setViewport({ x: 0, y: 0, width: 1, height: 1, visible: false })
        .catch((err) => log.warn('monitor hide viewport on dispose failed', err));
    }
  });
}
