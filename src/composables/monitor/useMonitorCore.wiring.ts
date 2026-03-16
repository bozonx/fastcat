import { watch } from 'vue';
import type { Ref } from 'vue';
import type { WorkerTimelineClip } from './types';
import {
  getMonitorLayoutUpdatePayload,
  hasProxyForMonitorSources,
  shouldScheduleAudioLayoutUpdate,
  shouldScheduleClipLayoutUpdate,
} from './useMonitorCore.watchers';

export interface RegisterMonitorCoreWatchersOptions {
  clipSourceSignature: Ref<number>;
  audioClipSourceSignature: Ref<number>;
  clipLayoutSignature: Ref<number>;
  audioClipLayoutSignature: Ref<number>;
  rawWorkerTimelineClips?: Ref<WorkerTimelineClip[]>;
  rawWorkerAudioClips?: Ref<WorkerTimelineClip[]>;
  workerTimelineClips: Ref<WorkerTimelineClip[]>;
  workerAudioClips: Ref<WorkerTimelineClip[]>;
  existingProxies: Ref<Set<string>>;
  useProxyInMonitor: Ref<boolean>;
  previewEffectsEnabled: Ref<boolean>;
  isLoading: Ref<boolean>;
  getIsUnmounted: () => boolean;
  getIsCompositorReady: () => boolean;
  getLastBuiltSourceSignature: () => number;
  getLastBuiltLayoutSignature: () => number;
  getLayoutUpdateFromQueue: () => boolean;
  getTimelineMasterGain: () => number;
  getTimelineAudioMuted: () => boolean;
  getMonitorVolume: () => number;
  getMonitorMuted: () => boolean;
  getProjectSizeKey: () => [number, number, number];
  getRenderTimeForLayoutUpdate: () => number;
  stopPlayback: () => void;
  clearAudioHandleCache: () => void;
  invalidateCompositor: () => void;
  updateCanvasDisplaySize: () => void;
  scheduleBuild: () => void;
  scheduleRender: (timeUs: number) => void;
  scheduleLayoutUpdate: (
    layoutClips: WorkerTimelineClip[],
    layoutAudioClips: WorkerTimelineClip[],
  ) => void;
  setAudioEngineMasterVolume: (volume: number) => void;
  setAudioEngineMonitorVolume: (volume: number) => void;
}

function getExistingProxies(existingProxies?: Ref<Set<string>>): Set<string> {
  return existingProxies?.value ?? new Set<string>();
}

function getProxyWatchKey(existingProxies: Set<string>): string {
  return Array.from(existingProxies).sort().join('\n');
}

export function registerMonitorCoreWatchers(options: RegisterMonitorCoreWatchersOptions) {
  watch(options.clipSourceSignature, () => {
    options.scheduleBuild();
  });

  watch(
    () => getProxyWatchKey(getExistingProxies(options.existingProxies)),
    () => {
      if (options.getIsUnmounted()) return;
      if (!options.useProxyInMonitor.value) return;

      const existingProxies = getExistingProxies(options.existingProxies);

      const hasNewProxyForClips = hasProxyForMonitorSources({
        clips: options.workerTimelineClips.value,
        audioClips: options.workerAudioClips.value,
        existingProxies,
      });

      if (hasNewProxyForClips) {
        options.scheduleBuild();
      }
    },
  );

  watch(options.audioClipSourceSignature, () => {
    options.scheduleBuild();
  });

  watch(
    () => options.useProxyInMonitor.value,
    () => {
      if (options.getIsUnmounted()) return;

      options.stopPlayback();
      options.clearAudioHandleCache();
      options.invalidateCompositor();
      options.scheduleBuild();
    },
  );

  watch(
    () => options.previewEffectsEnabled.value,
    () => {
      if (options.getIsUnmounted()) return;
      options.scheduleRender(options.getRenderTimeForLayoutUpdate());
    },
  );

  watch(options.clipLayoutSignature, () => {
    if (
      !shouldScheduleClipLayoutUpdate({
        isLoading: options.isLoading.value,
        isCompositorReady: options.getIsCompositorReady(),
        clipSourceSignature: options.clipSourceSignature.value,
        lastBuiltSourceSignature: options.getLastBuiltSourceSignature(),
        clipLayoutSignature: options.clipLayoutSignature.value,
        lastBuiltLayoutSignature: options.getLastBuiltLayoutSignature(),
        layoutUpdateFromQueue: options.getLayoutUpdateFromQueue(),
      })
    ) {
      return;
    }

    const { layoutClips, layoutAudioClips } = getMonitorLayoutUpdatePayload({
      rawWorkerTimelineClips: options.rawWorkerTimelineClips,
      rawWorkerAudioClips: options.rawWorkerAudioClips,
      workerTimelineClips: options.workerTimelineClips,
      workerAudioClips: options.workerAudioClips,
    });

    options.scheduleLayoutUpdate(layoutClips, layoutAudioClips);
  });

  watch(options.audioClipLayoutSignature, () => {
    if (
      !shouldScheduleAudioLayoutUpdate({
        isLoading: options.isLoading.value,
        isCompositorReady: options.getIsCompositorReady(),
      })
    ) {
      return;
    }

    const { layoutClips, layoutAudioClips } = getMonitorLayoutUpdatePayload({
      rawWorkerTimelineClips: options.rawWorkerTimelineClips,
      rawWorkerAudioClips: options.rawWorkerAudioClips,
      workerTimelineClips: options.workerTimelineClips,
      workerAudioClips: options.workerAudioClips,
    });

    options.scheduleLayoutUpdate(layoutClips, layoutAudioClips);
  });

  watch(
    () => [options.getTimelineMasterGain(), options.getTimelineAudioMuted()],
    () => {
      const effectiveMaster = options.getTimelineAudioMuted() ? 0 : options.getTimelineMasterGain();
      options.setAudioEngineMasterVolume(effectiveMaster);
    },
    { immediate: true },
  );

  watch(
    () => [options.getMonitorVolume(), options.getMonitorMuted()],
    () => {
      const effectiveMonitor = options.getMonitorMuted() ? 0 : options.getMonitorVolume();
      options.setAudioEngineMonitorVolume(effectiveMonitor);
    },
    { immediate: true },
  );

  watch(
    options.getProjectSizeKey,
    () => {
      options.updateCanvasDisplaySize();
      options.invalidateCompositor();
      options.scheduleBuild();
    },
    { flush: 'post' },
  );
}
