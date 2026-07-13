import { TICKS_PER_SECOND } from '~/utils/time';
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
import { isTimelinePerfEnabled, markTimeline } from '~/utils/timeline/perf';
import { buildNativeMonitorScene, type NativeMonitorScene } from '~/utils/native-monitor-scene';
import { clampGain } from '~/utils/audio/clamp';
import {
  isNativeMonitorDisabled,
  markNativeMonitorInitFailure,
  resetNativeMonitorAvailability,
} from '~/composables/monitor/native-monitor-availability';
import { stillFrameFullRes } from '~/composables/monitor/useNativeMonitorMode';

const log = createDevLogger('useNativeMonitorBridge');

interface NativeAudioTrackSelection {
  hasAudioSolo: boolean;
  videoTracksForAudio: TimelineTrack[];
  audioTracksForAudio: TimelineTrack[];
}

const NATIVE_TIME_STORE_SYNC_MS = 50;
// During playback, small currentTime adjustments (within this window) are treated as
// local-tick noise rather than a real seek — otherwise the native side would jump on every
// master-clock tick. Large jumps (playhead drag) are treated as a real seek.
const PLAYING_SEEK_IGNORE_US = 200_000;
// After any interactive action while paused (scrubbing, dragging clip parameters —
// transforms/effects/transitions, the moment playback stops), the frame is first rendered
// in the user-selected quality (cheap, no lag), and only rebuilt in ultra once activity has
// settled for this long. 500ms is a compromise: longer than 250ms so it doesn't fire in the
// middle of a series of small slider tweaks, and noticeably more responsive than a second
// (a sharp frame appears almost immediately after the user stops).
const ULTRA_SETTLE_DELAY_MS = 500;

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

export async function syncNativeMonitorScene(params: {
  scene: NativeMonitorScene;
  isPlaying: () => boolean;
  isNativeMonitorDisabled: () => boolean;
  setScene: (scene: NativeMonitorScene) => Promise<void>;
  pause: () => Promise<void>;
  warnFailure: (message: string, err: unknown) => void;
}): Promise<void> {
  await syncNativeMonitorTransportAfterScene({
    isPlaying: params.isPlaying(),
    isNativeMonitorDisabled: params.isNativeMonitorDisabled,
    pause: params.pause,
    warnFailure: params.warnFailure,
  });

  if (params.isNativeMonitorDisabled()) return;
  await params.setScene(params.scene);

  await syncNativeMonitorTransportAfterScene({
    isPlaying: params.isPlaying(),
    isNativeMonitorDisabled: params.isNativeMonitorDisabled,
    pause: params.pause,
    warnFailure: params.warnFailure,
  });
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
 * Binds the timeline to the native multi-layer monitor.
 *
 *   - scene = a snapshot of all video/image clips; z = trackIndex (higher = on top);
 *   - opacity = clip.opacity * (1 - transitions/masks?), for now only per-clip opacity is used;
 *   - every significant change sends `monitor_set_scene`;
 *   - transport (play/pause/seek) — separate commands by timeline-PTS;
 *   - master clock is native, it emits timeline-time in `monitor:time`.
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
  // Monotonic scene-build token: buildScene() is async, and without it a slower build started
  // earlier could finish later and overwrite a fresh scene with a stale one.
  let sceneBuildSeq = 0;
  // The frame has "settled" (no active scrubbing/edits) → ultra rendering is allowed. During
  // interaction this is set to false and the scene is built in the user-selected quality; once
  // debounced, the flag returns to true and the scene is rebuilt in ultra. See ULTRA_SETTLE_DELAY_MS.
  let idleSettled = true;
  let ultraSettleTimer: ReturnType<typeof setTimeout> | null = null;

  function cancelUltraSettle(): void {
    if (ultraSettleTimer !== null) {
      clearTimeout(ultraSettleTimer);
      ultraSettleTimer = null;
    }
  }

  // Full-resolution readback only makes sense on a settled still frame: paused and with no
  // active interaction. In other states we keep the 960-cap (see useNativeMonitorMode).
  function updateStillFrameFullRes(): void {
    stillFrameFullRes.value = !timelineStore.isPlaying && idleSettled;
  }
  // Initial state: a freshly loaded project on pause is already "settled" (idleSettled=true),
  // so the first still frame should be built at full resolution — just like ultra quality.
  updateStillFrameFullRes();

  // Opens an interactive window: the frame is considered "not settled" (rendered in the selected
  // quality), and after ULTRA_SETTLE_DELAY_MS of inactivity the scene is rebuilt in ultra.
  // Returns true if the flag just flipped from settled → interactive (the caller should send a
  // reduced-quality scene immediately — e.g. when scrubbing starts).
  function beginInteractiveWindow(): boolean {
    const wasSettled = idleSettled;
    idleSettled = false;
    updateStillFrameFullRes();
    cancelUltraSettle();
    ultraSettleTimer = setTimeout(() => {
      ultraSettleTimer = null;
      idleSettled = true;
      updateStillFrameFullRes();
      void syncScene();
    }, ULTRA_SETTLE_DELAY_MS);
    return wasSettled;
  }

  function warnMonitorFailure(message: string, err: unknown): void {
    const disabledNow = markNativeMonitorInitFailure(err);
    if (disabledNow || !isNativeMonitorDisabled()) {
      log.warn(message, err);
    }
  }

  async function buildScene(): Promise<NativeMonitorScene> {
    const doc = timelineStore.timelineDoc;
    // Raw `previewResolution`: a value > 0 pins the scale, while 0 (or missing) means
    // "auto" — the scene builder then derives the render scale from the quality tier.
    const previewScale = projectStore.activeMonitor?.previewResolution ?? 0;
    if (!doc?.tracks?.length) {
      const fmt = timelineStore.timelineFormat;
      return {
        layers: [],
        video_tracks: [],
        audio_layers: [],
        audio_tracks: [],
        audio_master_gain: clampGain(timelineStore.masterGain),
        audio_master_muted: Boolean(timelineStore.audioMuted),
        audio_master_effects: [],
        width: fmt?.width ?? 1920,
        height: fmt?.height ?? 1080,
        // Empty scene: nothing to render, so full res (auto sentinel 0 → 1).
        preview_scale: previewScale > 0 ? previewScale : 1,
        preview_fps: fmt?.fps ?? 30,
        preview_sync_mode: isMobile.value
          ? 'balanced'
          : workspaceStore.userSettings.optimization.nativeMonitorSyncMode,
        preview_effect_quality: 'ultra',
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
      isPlaying: timelineStore.isPlaying,
      idleSettled,
      previewBlurQuality: projectStore.activeMonitor?.previewBlurQuality ?? 'auto',
      isMobile: isMobile.value,
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
      // A newer build overtook us — exit so we don't clobber the fresh scene.
      if (disposed || seq !== sceneBuildSeq) return;
      if (isNativeMonitorDisabled()) return;
      const json = JSON.stringify(scene);
      if (json === lastSceneJson) return;
      lastSceneJson = json;
      await syncNativeMonitorScene({
        scene,
        isPlaying: () => timelineStore.isPlaying,
        isNativeMonitorDisabled,
        setScene: (nextScene) => nativeMonitorIpc.setScene(nextScene),
        pause: () => nativeMonitorIpc.pause(),
        warnFailure: warnMonitorFailure,
      });
    } catch (err) {
      warnMonitorFailure('monitor_set_scene failed', err);
    }
  }

  watch(
    () => ({
      inDevelopmentFeaturesEnabled: workspaceStore.inDevelopmentFeaturesEnabled,
      bufferSize: workspaceStore.userSettings.audioEngine.bufferSize,
      backend: workspaceStore.userSettings.audioEngine.backend,
    }),
    ({ inDevelopmentFeaturesEnabled, bufferSize, backend }) => {
      if (isNativeMonitorDisabled()) return;
      const settings: MonitorAudioSettingsInput = inDevelopmentFeaturesEnabled
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

  // The scene changes on edits to tracks/clips and the format.
  // We watch only tracks + format (not the whole doc) to avoid firing IPC on every
  // change to waveform data or UI fields that don't affect rendering.
  watch(
    [
      nativeMonitorTracks,
      () => timelineStore.timelineFormat,
      () => projectStore.activeMonitor?.previewResolution,
      () => projectStore.activeMonitor?.useProxy,
      () => proxyStore.existingProxies,
      () => workspaceStore.userSettings.optimization.nativeMonitorSyncMode,
      nativeMonitorMasterEffects,
      () => projectStore.activeMonitor?.previewBlurQuality,
    ],
    () => {
      // Clip edits (transforms/effects/transitions) etc. are interactive: rebuild the
      // scene immediately in the user-selected quality (the change is visible without lag),
      // and defer ultra until the end of the edit series (see beginInteractiveWindow).
      beginInteractiveWindow();
      void syncScene();
    },
    { deep: true, immediate: true },
  );

  // Master gain is updated through TauriAudioEngine's dedicated live IPC.
  // Master mute still changes the scene because it is part of the persisted
  // timeline mix state and must stay shared with export.
  watch(
    () => timelineStore.audioMuted,
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
        // During playback the quality is already user-selected — a deferred ultra frame is
        // unnecessary (and would add noisy IPC). Resolution also returns to the 960-cap.
        cancelUltraSettle();
        updateStillFrameFullRes();
      } else {
        awaitingFirstNativeTime = false;
        // Stopping is interactive too: show the frame in the selected quality; ultra on debounce.
        beginInteractiveWindow();
      }
      if (isNativeMonitorDisabled()) return;
      try {
        await (playing ? nativeMonitorIpc.play() : nativeMonitorIpc.pause());
      } catch (err) {
        warnMonitorFailure('monitor play/pause failed', err);
      }
      // Rebuild scene on play/pause to update transition blur quality. Playing → user-selected
      // quality; pausing → user quality now, upgraded to ultra after the settle debounce.
      void syncScene();
    },
  );

  // Global playback speed (multiplier of timeline time). The native side is the
  // master clock — it speeds up/slows down/reverses time and audio per this command.
  // immediate: keep the native speed in sync from mount onward (even when paused),
  // so playback starts at the right speed immediately.
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

  // Manual seek (when not suppressed by a native update).
  let seekThrottleId: ReturnType<typeof setTimeout> | null = null;
  let pendingSeekTimeSec = 0;
  let lastSeekTimeSec = 0;

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

      // Scrubbing while paused is interactive: render in the selected quality and defer ultra
      // until the end of the scrub. If the frame was "settled" (ultra), send a reduced-quality
      // scene immediately, otherwise every seek would block on an expensive ultra render (a
      // source of lag).
      if (!timelineStore.isPlaying && beginInteractiveWindow()) {
        void syncScene();
      }

      pendingSeekTimeSec = t / TICKS_PER_SECOND;
      if (seekThrottleId) {
        clearTimeout(seekThrottleId);
      }
      seekThrottleId = setTimeout(() => {
        seekThrottleId = null;
        const perfOn = isTimelinePerfEnabled();
        const seekTarget = pendingSeekTimeSec;
        const direction = seekTarget < lastSeekTimeSec ? 'backward' : 'forward';
        lastSeekTimeSec = seekTarget;
        const t0 = perfOn ? performance.now() : 0;
        void nativeMonitorIpc
          .seek(seekTarget)
          .then(() => {
            if (perfOn) {
              markTimeline(
                `monitor.seek[${direction}]`,
                performance.now() - t0,
                `to=${seekTarget.toFixed(3)}s`,
              );
            }
          })
          .catch((err) => {
            warnMonitorFailure('monitor_seek failed', err);
          });
      }, 16);
    },
    { flush: 'sync' },
  );

  // Native is the master clock: timeline-PTS (seconds) arrive in `monitor:time`.
  const unsubs: UnlistenFn[] = [];
  void onMonitorTime((timelineSec) => {
    if (disposed) return;
    const timelineUs = Math.round(timelineSec * TICKS_PER_SECOND);
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
    timelineStore.setCurrentTimeUs(timelineUs);
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
    cancelUltraSettle();
    if (!isNativeMonitorDisabled()) {
      // Pause playback and clear the scene to free resources, but do NOT close/kill the EventLoop
      // since winit EventLoop cannot be recreated in the same process on Linux.
      void nativeMonitorIpc
        .pause()
        .catch((err) => log.warn('monitor pause on dispose failed', err));
      void nativeMonitorIpc
        .setScene({
          layers: [],
          video_tracks: [],
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
          preview_effect_quality: 'ultra',
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
