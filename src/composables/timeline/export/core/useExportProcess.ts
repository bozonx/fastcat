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
import { buildNativeMonitorScene } from '~/utils/native-monitor-scene';
import { createGroupedWarningReporter } from '~/utils/grouped-warnings';

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
const AUDIO_ONLY_EXPORT_FORMATS = new Set(['aac', 'opus', 'ogg', 'flac', 'wav', 'pcm', 'mp3']);

function validateNativeExportDimensions(options: Pick<ExportOptions, 'width' | 'height'>) {
  const values = [
    ['width', options.width],
    ['height', options.height],
  ] as const;

  for (const [name, value] of values) {
    if (!Number.isInteger(value) || value < 2 || value > 16_384 || value % 2 !== 0) {
      throw new Error(`Invalid export ${name}: expected an even integer between 2 and 16384`);
    }
  }
}

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

    if (timelineStore.isPlaying) {
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
      const reportWarning = createGroupedWarningReporter(exportWarnings);

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

      if (isTauriRuntime()) {
        validateNativeExportDimensions(options);
        if (!nativeTargetPath) {
          throw new Error('Native target path is not available for Tauri export');
        }
        if (!doc) {
          throw new Error('Timeline document is empty');
        }

        exportPhase.value = 'encoding';
        const scene = await buildNativeMonitorScene({
          timelineDoc: doc,
          projectStore,
          workspaceStore,
          masterGain: timelineStore.masterGain,
          masterMuted: timelineStore.audioMuted,
          previewScale: 1,
          fallbackFormat: timelineStore.timelineFormat,
          includeAudio: options.audio,
          onWarning: reportWarning,
        });
        ensureNotCancelled();
        const rangeStartUs = options.exportRangeUs?.startUs ?? 0;
        const rangeEndUs = options.exportRangeUs?.endUs ?? timelineStore.duration;
        if (rangeEndUs <= rangeStartUs) {
          throw new Error('Export range is zero or negative');
        }
        // Native reports 1.0 once every frame has been handed to ffmpeg, but the
        // container is still being finalized (encoder flush + mp4 faststart remux),
        // which is slow for large files. Surface that tail as the 'saving' phase
        // instead of letting the bar sit at a seemingly-stuck 100% under 'encoding'.
        const onNativeProgress = (progress: number) => {
          if (progress >= 1 && exportPhase.value === 'encoding') {
            exportPhase.value = 'saving';
          }
          onProgress(progress);
        };
        await nativeExportTimeline({
          taskId: exportTaskId,
          scene,
          targetPath: nativeTargetPath,
          options: {
            width: options.width,
            height: options.height,
            fps: options.fps,
            startSec: rangeStartUs / 1_000_000,
            endSec: rangeEndUs / 1_000_000,
            videoCodec: options.videoCodec,
            videoBitrateBps: options.bitrate,
            format: options.format,
            audioEnabled: options.audio,
            audioCodec: options.audioCodec || null,
            audioBitrateBps: options.audioBitrate,
            audioChannels: options.audioChannels === 'mono' ? 1 : 2,
            audioSampleRate: options.audioSampleRate,
            videoEnabled: !AUDIO_ONLY_EXPORT_FORMATS.has(options.format),
            bitrateMode: options.bitrateMode ?? 'variable',
            keyframeIntervalSec: options.keyframeIntervalSec,
            metadataTitle: options.metadata?.title || null,
            metadataDescription: options.metadata?.description || null,
            metadataAuthor: options.metadata?.author || null,
            metadataTags: options.metadata?.tags || null,
            exportAlpha: options.exportAlpha,
          },
          onProgress: onNativeProgress,
          onWarning: reportWarning,
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
          reportWarning(message);
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
        const cancelled = await nativeCancelMediaTask(exportTaskId).catch((e) => {
          log.warn('Failed to request native export cancel', e);
          return false;
        });
        if (!cancelled) {
          log.warn('Native export task was not cancelled', { exportTaskId });
        }
        return;
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
