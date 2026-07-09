import { createDevLogger } from '~/utils/dev-logger';
import { PIXI_RENDERER_PREFERENCE } from '~/utils/constants';
import { useResizeObserver } from '@vueuse/core';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { isTauriRuntime } from '~/utils/runtime';
import {
  broadcastPixiRendererPreference,
  getPreviewWorkerClient,
  setPreviewHostApi,
} from '~/utils/video-editor/worker-client';

import { createAudioEngine } from '~/utils/video-editor/AudioEngine';
import { TRANSFORM_DESIGN_BASE } from '~/utils/video-editor/clip-layout';
import { clampTimeUs } from '~/utils/time';
import { useVfs } from '~/composables/useVfs';
import { toProjectTempVfsPath } from '~/utils/storage-topology';

import type { WorkerTimelineClip } from './types';
import type { UseMonitorCoreOptions } from './useMonitorCore.types';
import { cloneWorkerPayload, createPreviewRenderOptions } from './useMonitorCore.helpers';
import { resolvePreviewEffectQuality } from '~/utils/preview-effect-quality';
import { mapAudioEngineClips } from './useMonitorCore.audio';
import { createMonitorCompositorRuntime } from './useMonitorCore.compositor';
import { createMonitorPreviewHostApi } from './useMonitorCore.hostApi';
import {
  disposeMonitorCoreRuntime,
  initializeMonitorCoreRuntime,
} from './useMonitorCore.lifecycle';
import { createMonitorCoreQueues } from './useMonitorCore.queues';
import {
  computeMonitorTimelineDuration,
  prepareMonitorTimelineState,
} from './useMonitorCore.timeline';
import { registerMonitorCoreWatchers } from './useMonitorCore.wiring';
const log = createDevLogger('useMonitorCore');

// True only when the live document actually carries clip/gap items on some
// track. A freshly created (or emptied) timeline still ships its default empty
// tracks, so `tracks.length` is a misleading proxy for "has content".
function docHasClipItems(
  doc: { tracks?: Array<{ items?: unknown[] }> } | null | undefined,
): boolean {
  return (doc?.tracks ?? []).some((track) => (track?.items?.length ?? 0) > 0);
}

export function useMonitorCore(options: UseMonitorCoreOptions) {
  const { t } = useI18n();
  const toast = useToast();
  const uiStore = useUiStore();
  const workspaceStore = useWorkspaceStore();
  const currentProjectStore = useProjectStore();
  const { projectStore, timelineStore, proxyStore, monitorTimeline, monitorDisplay } = options;

  const {
    rawWorkerTimelineClips,
    rawWorkerAudioClips,
    workerTimelineClips,
    workerAudioClips,
    workerTimelinePayload,
    safeDurationUs,
    clipSourceSignature,
    clipLayoutSignature,
    clipContentSignature,
    activeLayoutSignature,
    audioClipSourceSignature,
    audioClipLayoutSignature,
  } = monitorTimeline;

  const {
    containerEl,
    viewportEl,
    renderWidth,
    renderHeight,
    exportWidth,
    exportHeight,
    updateCanvasDisplaySize,
  } = monitorDisplay;

  const isLoading = ref(false);
  const loadError = ref<string | null>(null);

  const BUILD_DEBOUNCE_MS = 120;
  const LAYOUT_DEBOUNCE_MS = 50;
  // Mirrors the native monitor's idle-settle window (useNativeMonitorBridge.ts): after any
  // interactive edit while paused (scrub, effect/transform param drag, stopping playback) the
  // frame first renders at the user-selected motion quality, then upgrades to `ultra` once
  // ULTRA_SETTLE_DELAY_MS passes without another interaction — so a fast scrub/edit series
  // doesn't trigger a full-quality render on every intermediate step.
  const ULTRA_SETTLE_DELAY_MS = 500;

  let buildRequestId = 0;
  let lastBuiltSourceSignature = 0;
  let lastBuiltLayoutSignature = 0;
  let lastBuiltContentSignature = 0;
  let lastActiveLayoutSignature = 0;
  let isUnmounted = false;
  let forceRecreateCompositorNextBuild = false;
  let currentTimeProvider: (() => number) | null = null;
  let layoutUpdateFromQueue = false;
  const audioHandleCache = new Map<string, FileSystemFileHandle>();
  let resizeScheduled = false;
  let workerTimelineOperation: Promise<void> = Promise.resolve();
  let idleSettled = true;
  let ultraSettleTimer: ReturnType<typeof setTimeout> | null = null;

  function cancelUltraSettle() {
    if (ultraSettleTimer !== null) {
      clearTimeout(ultraSettleTimer);
      ultraSettleTimer = null;
    }
  }

  // Opens the interactive window: subsequent renders use the user-selected quality until
  // ULTRA_SETTLE_DELAY_MS passes without another call, at which point the frame is
  // re-rendered once at `ultra`. Returns true if the flag just flipped settled -> interactive
  // (i.e. the caller should kick a render right away at the lower quality).
  function beginInteractiveWindow(): boolean {
    const wasSettled = idleSettled;
    idleSettled = false;
    cancelUltraSettle();
    ultraSettleTimer = setTimeout(() => {
      ultraSettleTimer = null;
      idleSettled = true;
      scheduleRender(getRenderTimeForLayoutUpdate());
    }, ULTRA_SETTLE_DELAY_MS);
    return wasSettled;
  }

  const audioEngine = createAudioEngine({
    getVfs: () => useVfs(),
    getAudioCacheVfsPath: () => {
      const projectId = currentProjectStore.currentProjectId;
      if (!projectId) return null;
      if (workspaceStore.workspaceProviderId !== 'tauri' && !workspaceStore.workspaceHandle)
        return null;

      return toProjectTempVfsPath(projectId, ['audio-cache']);
    },
  });
  const { client } = isTauriRuntime() ? { client: null } : getPreviewWorkerClient();
  const compositorRuntime = createMonitorCompositorRuntime({
    client,
    containerEl,
    renderWidth,
    renderHeight,
    // Text font size is authored in the fixed 1920x1080 design space
    // (TRANSFORM_DESIGN_BASE), the same base the native compositor uses for
    // glyph render-scale (layer_builder.rs) and the same base web already uses
    // for text positions. Passing the project/export resolution here would size
    // glyphs off the project pixels instead, making web text 1920/projectWidth
    // times larger than native (e.g. 1.5x on a 1280-wide project).
    designWidth: { value: TRANSFORM_DESIGN_BASE.width },
    designHeight: { value: TRANSFORM_DESIGN_BASE.height },
    isUnmounted: () => isUnmounted,
    getPreviewRenderOptions,
  });

  useResizeObserver(viewportEl, () => {
    if (isUnmounted || resizeScheduled) {
      return;
    }

    resizeScheduled = true;
    requestAnimationFrame(() => {
      resizeScheduled = false;
      updateCanvasDisplaySize();
    });
  });

  const useProxyInMonitor = computed(() => {
    return projectStore.activeMonitor?.useProxy !== false;
  });

  const previewEffectsEnabled = computed(() => {
    return projectStore.activeMonitor?.previewEffectsEnabled !== false;
  });

  const previewEffectQualitySetting = computed(
    () => projectStore.activeMonitor?.previewBlurQuality ?? 'auto',
  );

  const pixiRenderer = computed(() => {
    return PIXI_RENDERER_PREFERENCE;
  });

  function getPreviewRenderOptions() {
    return createPreviewRenderOptions({
      previewEffectsEnabled: previewEffectsEnabled.value,
      pixiRenderer: PIXI_RENDERER_PREFERENCE,
      monitorSyncMode: options.isMobile?.value
        ? 'balanced'
        : workspaceStore.userSettings.optimization.nativeMonitorSyncMode,
      previewEffectQuality: resolvePreviewEffectQuality({
        setting: projectStore.activeMonitor?.previewBlurQuality ?? 'auto',
        isPlaying: timelineStore.isPlaying,
        idleSettled,
        isMobile: options.isMobile?.value,
        // Feed the *full* scene size, never the already-scaled render size: the tier is the
        // single dial that derives both the effect budget and (in auto mode) the render scale,
        // so scaled dims would double-count the scaling and diverge from the native path
        // (native-monitor-scene.ts resolveNativePreviewEffectQuality).
        width: exportWidth.value,
        height: exportHeight.value,
        fps: timelineStore.timelineFormat?.fps,
      }),
    });
  }

  function setCurrentTimeProvider(provider: () => number) {
    currentTimeProvider = provider;
  }

  async function syncAudioEngineClips(audioClips: WorkerTimelineClip[]) {
    const audioEngineClips = await mapAudioEngineClips({
      clips: audioClips,
      useProxyInMonitor: useProxyInMonitor.value,
      audioHandleCache,
      getProxyFileHandle: proxyStore.getProxyFileHandle,
      getFileHandleByPath: projectStore.getFileHandleByPath,
    });

    return audioEngineClips;
  }

  function getRenderTimeForLayoutUpdate() {
    if (currentTimeProvider) return currentTimeProvider();
    return clampToTimeline(timelineStore.currentTime);
  }

  async function flushLayoutUpdate() {
    try {
      const preparedTimeline = await prepareMonitorTimelineState({
        tracks: timelineStore.timelineDoc?.tracks ?? [],
        projectStore,
        workspaceStore,
        masterEffects: timelineStore.timelineDoc?.metadata?.fastcat?.masterEffects,
        fallbackFormat: timelineStore.timelineFormat ?? undefined,
      });
      const flattenedClips = preparedTimeline.flattenedClips;
      const flattenedAudio = preparedTimeline.flattenedAudio;

      workerTimelineClips.value = flattenedClips;
      workerAudioClips.value = flattenedAudio;
      workerTimelinePayload.value = preparedTimeline.payload;

      layoutUpdateFromQueue = true;

      const payload = cloneWorkerPayload(preparedTimeline.payload);
      const maxDuration = await runWorkerTimelineOperation(async () => {
        await ensureCompositorReady();
        if (!client) {
          return flattenedClips.reduce((max, clip) => {
            return Math.max(max, clip.timelineRange.startUs + clip.timelineRange.durationUs);
          }, 0);
        }
        return await client.updateTimelineLayout(payload);
      });
      timelineStore.duration = Math.max(
        timelineStore.duration,
        computeMonitorTimelineDuration({
          currentDurationUs: timelineStore.duration,
          maxDurationUs: maxDuration,
          audioDurationUs: preparedTimeline.audioDurationUs,
        }),
      );
      lastBuiltLayoutSignature = clipLayoutSignature.value;
      lastBuiltContentSignature = clipContentSignature.value;

      const currentActiveLayoutSignature = activeLayoutSignature.value;
      const shouldScheduleRender = currentActiveLayoutSignature !== lastActiveLayoutSignature;
      lastActiveLayoutSignature = currentActiveLayoutSignature;

      if (shouldScheduleRender) {
        // A layout change while paused is a clip/effect/transform param edit — interactive,
        // so render at the user-selected quality first and let the settle timer upgrade it.
        if (!timelineStore.isPlaying) beginInteractiveWindow();
        scheduleRender(getRenderTimeForLayoutUpdate());
      }
    } catch (error) {
      log.error('[Monitor] Failed to update timeline layout', error);
      toast.add({
        color: 'error',
        title: t('fastcat.monitor.playbackStopped'),
        description: t('fastcat.monitor.layoutError'),
      });
      timelineStore.isPlaying = false;
      scheduleBuild();
    } finally {
      layoutUpdateFromQueue = false;
    }

    try {
      const audioClips = workerAudioClips.value;
      const audioEngineClips = await syncAudioEngineClips(audioClips);
      await audioEngine.updateTimelineLayout(audioEngineClips);
      if (options.monitorTimeline.masterAudioEffects) {
        audioEngine.setMasterAudioEffects(options.monitorTimeline.masterAudioEffects.value);
      }
    } catch (audioErr) {
      log.error('[Monitor] Failed to update audio engine layout', audioErr);
    }
  }

  const queues = createMonitorCoreQueues({
    buildDebounceMs: BUILD_DEBOUNCE_MS,
    layoutDebounceMs: LAYOUT_DEBOUNCE_MS,
    isUnmounted: () => isUnmounted,
    flushBuild: buildTimeline,
    flushLayoutUpdate,
  });

  const scheduleBuild = queues.scheduleBuild;
  const scheduleLayoutUpdate = (debounceMs?: number) => {
    queues.scheduleLayoutUpdate(debounceMs);
  };

  const scheduleRender = compositorRuntime.scheduleRender;

  function updateStoreTime(timeUs: number) {
    const normalizedTimeUs = clampToTimeline(timeUs);
    if (timelineStore.currentTime === normalizedTimeUs) {
      return;
    }
    timelineStore.setCurrentTimeUs(normalizedTimeUs);
  }

  function clampToTimeline(timeUs: number): number {
    return clampTimeUs(timeUs, safeDurationUs.value);
  }

  async function ensureCompositorReady(options?: { forceRecreate?: boolean }) {
    await compositorRuntime.ensureReady(options);
  }

  async function runWorkerTimelineOperation<T>(operation: () => Promise<T>): Promise<T> {
    const nextOperation = workerTimelineOperation.catch(() => undefined).then(operation);
    workerTimelineOperation = nextOperation.then(
      () => undefined,
      () => undefined,
    );
    return nextOperation;
  }

  async function buildTimeline() {
    if (!containerEl.value) return;
    const requestId = ++buildRequestId;

    // Loader fully removed by request, so it doesn't block the preview

    loadError.value = null;

    try {
      // Invalidate audio handle cache on full rebuild
      audioHandleCache.clear();

      const preparedTimeline = await prepareMonitorTimelineState({
        tracks: timelineStore.timelineDoc?.tracks ?? [],
        projectStore,
        workspaceStore,
        masterEffects: timelineStore.timelineDoc?.metadata?.fastcat?.masterEffects,
        fallbackFormat: timelineStore.timelineFormat ?? undefined,
      });
      const flattenedClips = preparedTimeline.flattenedClips;
      const flattenedAudio = preparedTimeline.flattenedAudio;

      workerTimelineClips.value = flattenedClips;
      workerAudioClips.value = flattenedAudio;
      workerTimelinePayload.value = preparedTimeline.payload;

      const clips = flattenedClips;
      const audioClips = flattenedAudio;

      lastBuiltSourceSignature = clipSourceSignature.value;
      lastBuiltLayoutSignature = clipLayoutSignature.value;
      lastBuiltContentSignature = clipContentSignature.value;
      lastActiveLayoutSignature = activeLayoutSignature.value;

      if (clips.length === 0 && audioClips.length === 0) {
        // Re-check if the timeline loaded during our async operations.
        // If it has content now, a follow-up build is already scheduled by
        // the clipSourceSignature watcher — skip all state mutations here
        // to avoid clearing the compositor and resetting the playhead with
        // stale (pre-load) data.
        //
        // "Content" means actual clip items, NOT merely that tracks exist: a
        // freshly created (or genuinely emptied) timeline still carries its
        // default empty tracks, so a track-count check would misfire and skip
        // clearing the compositor — leaving the *previous* timeline's clips on
        // screen (they'd even re-render as the playhead moves).
        if (docHasClipItems(timelineStore.timelineDoc)) {
          isLoading.value = false;
          return;
        }

        await runWorkerTimelineOperation(async () => {
          await ensureCompositorReady({ forceRecreate: forceRecreateCompositorNextBuild });
          forceRecreateCompositorNextBuild = false;
          if (client) {
            await client.clearClips();
          }
        });
        await audioEngine.loadClips([]);
        if (requestId !== buildRequestId) {
          return;
        }
        // Re-check AFTER the (slow) compositor init above: that async gap is
        // exactly when the initial project load lands. This build may have been
        // scheduled on mount, started while `timelineDoc` was still null, and
        // only now woken up — by which point the real timeline (with its clips)
        // has loaded and the playhead has been restored. If the doc gained
        // content meanwhile, a follow-up build is already queued by the
        // clipSourceSignature watcher; bail instead of mutating store state from
        // the stale "empty" snapshot this build started with.
        const hasContentAfterInit = docHasClipItems(timelineStore.timelineDoc);
        if (timelineStore.timelineDoc !== null && !hasContentAfterInit) {
          timelineStore.duration = 0;
          // Never reset the playhead here: it is editor/user state, not derived
          // from the clip set. Forcing it to 0 would clobber a restored or
          // user-set position (and the save watcher would then persist that 0).
        }
        // Force a render of the now-empty stage so the compositor visibly clears
        // the previous timeline's last frame instead of leaving it on the canvas
        // until the next unrelated render request.
        scheduleRender(getRenderTimeForLayoutUpdate());
        isLoading.value = false;
        return;
      }

      if (client) {
        setPreviewHostApi(
          createMonitorPreviewHostApi({
            currentProjectId: currentProjectStore.currentProjectId,
            workspaceHandle: workspaceStore.workspaceHandle,
            resolvedStorageTopology: workspaceStore.resolvedStorageTopology,
            useProxyInMonitor: useProxyInMonitor.value,
            getProxyFileHandle: proxyStore.getProxyFileHandle,
            getProxyFile: proxyStore.getProxyFile,
            getFileHandleByPath: projectStore.getFileHandleByPath,
            getFileByPath: projectStore.getFileByPath,
          }),
        );
      }

      const payload = cloneWorkerPayload(preparedTimeline.payload);
      const maxDuration = await runWorkerTimelineOperation(async () => {
        await ensureCompositorReady({ forceRecreate: forceRecreateCompositorNextBuild });
        forceRecreateCompositorNextBuild = false;
        if (!client) {
          return clips.reduce((max, clip) => {
            return Math.max(max, clip.timelineRange.startUs + clip.timelineRange.durationUs);
          }, 0);
        }
        return clips.length > 0 ? await client.loadTimeline(payload, requestId) : 0;
      });
      if (requestId !== buildRequestId) {
        return;
      }
      if (clips.length === 0) {
        await runWorkerTimelineOperation(async () => {
          if (client) {
            await client.clearClips();
          }
        });
      }

      await audioEngine.init({
        sampleRate:
          timelineStore.timelineFormat?.sampleRate ??
          projectStore.projectSettings?.project?.sampleRate,
      });

      const audioEngineClips = await syncAudioEngineClips(audioClips);
      await audioEngine.loadClips(audioEngineClips);
      if (options.monitorTimeline.masterAudioEffects) {
        audioEngine.setMasterAudioEffects(options.monitorTimeline.masterAudioEffects.value);
      }

      // Keep store duration at least as large as current value to avoid clamping
      // when disabled clips are excluded from the worker payload.
      timelineStore.duration = Math.max(
        timelineStore.duration,
        computeMonitorTimelineDuration({
          currentDurationUs: timelineStore.duration,
          maxDurationUs: maxDuration,
          audioDurationUs: preparedTimeline.audioDurationUs,
          normalize: true,
        }),
      );

      // Render at current time without clamping — the dispatchers already
      // keep duration including disabled clips.
      scheduleRender(getRenderTimeForLayoutUpdate());
    } catch (e: unknown) {
      const err = e instanceof Error ? e : null;
      if (err?.name === 'AbortError' && requestId !== buildRequestId) {
        return;
      }
      log.error('Failed to build timeline components', e);
      if (requestId === buildRequestId) {
        loadError.value = err?.message || t('fastcat.monitor.loadError');
      }
      toast.add({
        color: 'error',
        title: t('fastcat.monitor.previewError'),
        description: err?.message || t('fastcat.monitor.loadError'),
      });
    } finally {
      if (requestId === buildRequestId) {
        isLoading.value = false;
      }
    }
  }

  // Resuming playback makes the pending settle-timer moot (motion already renders at the
  // user-selected quality) — cancel it so it doesn't fire a stray render mid-playback.
  watch(
    () => timelineStore.isPlaying,
    (playing) => {
      if (playing) cancelUltraSettle();
    },
  );

  registerMonitorCoreWatchers({
    clipSourceSignature,
    audioClipSourceSignature,
    clipLayoutSignature,
    audioClipLayoutSignature,
    rawWorkerTimelineClips,
    rawWorkerAudioClips,
    workerTimelineClips,
    workerAudioClips,
    existingProxies: proxyStore.existingProxies,
    useProxyInMonitor,
    previewEffectsEnabled,
    previewEffectQualitySetting,
    pixiRenderer,
    isLoading,
    getIsUnmounted: () => isUnmounted,
    getIsCompositorReady: compositorRuntime.isReady,
    getLastBuiltSourceSignature: () => lastBuiltSourceSignature,
    getLastBuiltLayoutSignature: () => lastBuiltLayoutSignature,
    getLastBuiltContentSignature: () => lastBuiltContentSignature,
    getLayoutUpdateFromQueue: () => layoutUpdateFromQueue,
    getTimelineMasterGain: () => timelineStore.masterGain,
    getTimelineAudioMuted: () => timelineStore.audioMuted,
    getMonitorVolume: () => uiStore.monitorVolume,
    getMonitorMuted: () => uiStore.monitorMuted,
    // Stable primitive key: `timelineFormat` is a computed off the whole doc, so
    // it returns a fresh object on every edit (including marker moves). Returning
    // an array here made the watch compare by reference and fire on every doc
    // change, needlessly invalidating the compositor + rebuilding (a visible
    // flicker). A string compares by value, so the watch fires only when the
    // dimensions actually change.
    getProjectSizeKey: () =>
      `${timelineStore.timelineFormat?.width ?? projectStore.projectSettings?.project?.width ?? 0}x${
        timelineStore.timelineFormat?.height ?? projectStore.projectSettings?.project?.height ?? 0
      }x${projectStore.activeMonitor?.previewResolution ?? 0}`,
    getRenderTimeForLayoutUpdate,
    stopPlayback: () => {
      timelineStore.isPlaying = false;
    },
    clearAudioHandleCache: () => {
      audioHandleCache.clear();
      forceRecreateCompositorNextBuild = true;
    },
    invalidateCompositor: compositorRuntime.invalidate,
    updateCanvasDisplaySize,
    scheduleBuild,
    scheduleRender,
    clipContentSignature,
    activeLayoutSignature,
    clipLayoutDebounceMs: 200,
    clipContentDebounceMs: 1000,
    audioLayoutDebounceMs: LAYOUT_DEBOUNCE_MS,
    scheduleLayoutUpdate,
    setAudioEngineMasterVolume: (volume) => {
      audioEngine.setMasterVolume(volume);
    },
    setAudioEngineMonitorVolume: (volume) => {
      audioEngine.setMonitorVolume(volume);
    },
  });

  onMounted(() => {
    initializeMonitorCoreRuntime({
      setUnmounted: (value) => {
        isUnmounted = value;
      },
      updateCanvasDisplaySize,
      scheduleBuild,
    });
    void broadcastPixiRendererPreference(PIXI_RENDERER_PREFERENCE);
  });

  onBeforeUnmount(async () => {
    cancelUltraSettle();
    await disposeMonitorCoreRuntime({
      setUnmounted: (value) => {
        isUnmounted = value;
      },
      stopPlayback: () => {
        timelineStore.isPlaying = false;
      },
      clearPendingRender: compositorRuntime.clearPendingRender,
      clearQueues: queues.clear,
      destroyAudioEngine: () => {
        audioEngine.destroy();
      },
      destroyCompositor: compositorRuntime.destroy,
    });
  });

  return {
    audioEngine,
    beginInteractiveWindow,
    clampToTimeline,
    isLoading,
    loadError,
    previewEffectsEnabled,
    scheduleBuild,
    scheduleRender,
    setCurrentTimeProvider,
    updateStoreTime,
    useProxyInMonitor,
  };
}
