import { createDevLogger } from '~/utils/dev-logger';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { isTauriRuntime } from '~/utils/io/io-governor';
import {
  getNativeFileHandlePath,
  nativeCancelMediaTask,
  nativeExportTimeline,
} from '~/utils/tauri-media-processing';
import { randomToken } from '~/utils/ids';
import {
  broadcastPixiRendererPreference,
  getExportWorkerClient,
  registerExportTaskHostApi,
  setExportHostApi,
  terminateExportWorker,
  unregisterExportTaskHostApi,
} from '~/utils/video-editor/worker-client';
import { createVideoCoreHostApi } from '~/utils/video-editor/createVideoCoreHostApi';
import { buildEffectiveAudioClipItems } from '~/utils/audio/track-bus';
import type { TimelineDocument } from '~/timeline/types';
import { buildNativeMonitorScene } from '~/timeline/timeline-thumbnail';

import type { ExportOptions, WorkerTimelineClip } from '../types';
import {
  buildVideoWorkerPayload,
  buildVideoWorkerPayloadFromTracks,
  toWorkerTimelineClips,
  trimWorkerClipToRange,
} from '../payloadBuilder';
const log = createDevLogger('useExportProcess');

let timelineExportInFlight = false;
const CANCEL_FORCE_TERMINATE_TIMEOUT_MS = 15_000;

export function useExportProcess(
  activeExportTaskId: ReturnType<
    (typeof import('./useExportState'))['useExportState']
  >['activeExportTaskId'],
  exportPhase: ReturnType<(typeof import('./useExportState'))['useExportState']>['exportPhase'],
  exportWarnings: ReturnType<
    (typeof import('./useExportState'))['useExportState']
  >['exportWarnings'],
  isExporting: ReturnType<(typeof import('./useExportState'))['useExportState']>['isExporting'],
  cancelRequested: ReturnType<
    (typeof import('./useExportState'))['useExportState']
  >['cancelRequested'],
) {
  const workspaceStore = useWorkspaceStore();
  const projectStore = useProjectStore();
  const timelineStore = useTimelineStore();

  async function exportTimelineToFile(
    options: ExportOptions & { audioSampleRate: number },
    fileHandle: FileSystemFileHandle,
    onProgress: (progress: number) => void,
  ): Promise<void> {
    if (timelineExportInFlight) {
      throw new Error('Another timeline export is already in progress');
    }

    if (!isTauriRuntime() && timelineStore.isPlaying) {
      timelineStore.stopPlayback();
    }

    timelineExportInFlight = true;
    const exportTaskId = `timeline-export-${Date.now()}-${randomToken()}`;
    activeExportTaskId.value = exportTaskId;
    cancelRequested.value = false;

    try {
      const ensureNotCancelled = () => {
        if (!cancelRequested.value) return;
        const abortErr = new Error('Export was cancelled');
        abortErr.name = 'AbortError';
        throw abortErr;
      };

      exportPhase.value = 'preparing';
      const doc = timelineStore.timelineDoc;
      const allVideoTracks = doc?.tracks?.filter((track) => track.kind === 'video') ?? [];
      const allAudioTracks = doc?.tracks?.filter((track) => track.kind === 'audio') ?? [];

      const exportRangeUs = options.exportRangeUs;
      const reportWarning = (message: string) => {
        exportWarnings.value.push(message);
      };

      ensureNotCancelled();
      const nestedDocCache = new Map<string, TimelineDocument>();
      const builtVideo = await buildVideoWorkerPayloadFromTracks({
        tracks: doc?.tracks ?? [],
        projectStore,
        workspaceStore,
        masterEffects: doc?.metadata?.fastcat?.masterEffects,
        fallbackFormat: timelineStore.timelineFormat,
        onWarning: reportWarning,
        nestedDocCache,
      });

      ensureNotCancelled();
      const croppedVideoClips = exportRangeUs
        ? builtVideo.clips
            .map((clip) => trimWorkerClipToRange(clip, exportRangeUs))
            .filter((clip): clip is WorkerTimelineClip => clip !== null)
        : builtVideo.clips;

      const videoPayload = buildVideoWorkerPayload({
        clips: croppedVideoClips,
        tracks: builtVideo.tracks,
        masterEffects: doc?.metadata?.fastcat?.masterEffects,
      });

      let croppedAudioClips: WorkerTimelineClip[] = [];
      if (options.audio) {
        const effectiveAudioItems = buildEffectiveAudioClipItems({
          audioTracks: allAudioTracks,
          videoTracks: allVideoTracks,
          masterEffects: doc?.metadata?.fastcat?.masterEffects,
        });

        ensureNotCancelled();
        const masterGain = timelineStore.audioMuted ? 0 : timelineStore.masterGain;
        const audioClips = (
          await toWorkerTimelineClips(effectiveAudioItems, projectStore, workspaceStore, {
            trackKind: 'audio',
            fallbackFormat: timelineStore.timelineFormat,
            onWarning: reportWarning,
            nestedDocCache,
          })
        ).map((clip) => ({
          ...clip,
          audioGain: (clip.audioGain ?? 1) * masterGain,
        }));

        croppedAudioClips = exportRangeUs
          ? audioClips
              .map((clip) => trimWorkerClipToRange(clip, exportRangeUs))
              .filter((clip): clip is WorkerTimelineClip => clip !== null)
          : audioClips;
      }

      if (!croppedVideoClips.length && !croppedAudioClips.length)
        throw new Error('Timeline is empty');

      const nativeTargetPath = getNativeFileHandlePath(fileHandle);
      const canUseNativeExport =
        isTauriRuntime() &&
        Boolean(nativeTargetPath) &&
        !options.audio &&
        ['mp4', 'webm', 'mkv'].includes(options.format);

      if (canUseNativeExport && nativeTargetPath && doc) {
        exportPhase.value = 'encoding';
        const scene = await buildNativeMonitorScene(doc);
        const rangeStartUs = options.exportRangeUs?.startUs ?? 0;
        const rangeEndUs = options.exportRangeUs?.endUs ?? timelineStore.duration;
        await nativeExportTimeline({
          taskId: exportTaskId,
          scene,
          targetPath: nativeTargetPath,
          options: {
            width: options.width,
            height: options.height,
            fps: options.fps,
            startSec: rangeStartUs / 1_000_000,
            endSec: Math.max(rangeStartUs + 1, rangeEndUs) / 1_000_000,
            videoCodec: options.videoCodec,
            videoBitrateBps: options.bitrate,
            format: options.format,
            audioPath: null,
            audioCodec: null,
            audioBitrateBps: null,
          },
          onProgress,
        });
        return;
      }

      const { client } = getExportWorkerClient();
      await broadcastPixiRendererPreference(workspaceStore.userSettings.optimization.pixiRenderer);

      setExportHostApi(
        createVideoCoreHostApi({
          getCurrentProjectId: () => projectStore.currentProjectId,
          getWorkspaceHandle: () => workspaceStore.workspaceHandle,
          getResolvedStorageTopology: () => workspaceStore.resolvedStorageTopology,
          getFileHandleByPath: async (path) => projectStore.getFileHandleByPath(path),
          getFileByPath: async (path) => projectStore.getFileByPath(path),
          onExportProgress: () => {},
        }),
      );
      registerExportTaskHostApi(exportTaskId, {
        onExportProgress: (progress) => onProgress(progress / 100),
        onExportPhase: (phase) => {
          exportPhase.value = phase;
        },
        onExportWarning: (message) => {
          exportWarnings.value.push(message);
        },
      });

      ensureNotCancelled();
      await client.exportTimeline(
        fileHandle,
        options,
        videoPayload,
        croppedAudioClips,
        exportTaskId,
      );
    } finally {
      unregisterExportTaskHostApi(exportTaskId);
      if (activeExportTaskId.value === exportTaskId) {
        activeExportTaskId.value = null;
      }
      timelineExportInFlight = false;
    }
  }

  async function cancelExport() {
    if (!isExporting.value) return;
    if (cancelRequested.value) return;
    const exportTaskId = activeExportTaskId.value;
    if (!exportTaskId) return;
    cancelRequested.value = true;

    if (exportPhase.value === 'preparing') return;

    try {
      if (isTauriRuntime()) {
        await nativeCancelMediaTask(exportTaskId).catch(() => false);
      }
      const { client } = getExportWorkerClient();
      await client.cancelExport(exportTaskId);
    } catch (e) {
      log.warn('Failed to request cooperative export cancel', e);
    }

    setTimeout(() => {
      if (!cancelRequested.value) return;
      if (activeExportTaskId.value !== exportTaskId) return;
      log.warn(
        `[Export] Cooperative cancel did not complete within ${CANCEL_FORCE_TERMINATE_TIMEOUT_MS}ms; terminating export worker.`,
      );
      terminateExportWorker('Export cancelled (forced)');
    }, CANCEL_FORCE_TERMINATE_TIMEOUT_MS);
  }

  return {
    exportTimelineToFile,
    cancelExport,
  };
}
