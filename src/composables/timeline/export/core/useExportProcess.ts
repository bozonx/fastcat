import { ref } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import {
  getExportWorkerClient,
  registerExportTaskHostApi,
  setExportHostApi,
  unregisterExportTaskHostApi,
} from '~/utils/video-editor/worker-client';
import { createVideoCoreHostApi } from '~/utils/video-editor/createVideoCoreHostApi';
import { buildEffectiveAudioClipItems } from '~/utils/audio/track-bus';

import type { ExportOptions, WorkerTimelineClip } from '../types';
import {
  buildVideoWorkerPayload,
  buildVideoWorkerPayloadFromTracks,
  toWorkerTimelineClips,
  trimWorkerClipToRange,
} from '../payloadBuilder';

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
    const exportTaskId = `timeline-export-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    activeExportTaskId.value = exportTaskId;
    cancelRequested.value = false;

    exportPhase.value = 'preparing';
    const doc = timelineStore.timelineDoc;
    const allVideoTracks = doc?.tracks?.filter((track) => track.kind === 'video') ?? [];
    const allAudioTracks = doc?.tracks?.filter((track) => track.kind === 'audio') ?? [];

    const exportRangeUs = options.exportRangeUs;

    const builtVideo = await buildVideoWorkerPayloadFromTracks({
      tracks: doc?.tracks ?? [],
      projectStore,
      workspaceStore,
      masterEffects: doc?.metadata?.fastcat?.masterEffects,
    });

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

    const effectiveAudioItems = buildEffectiveAudioClipItems({
      audioTracks: allAudioTracks,
      videoTracks: allVideoTracks,
      masterEffects: doc?.metadata?.fastcat?.masterEffects,
    });

    const masterGain = timelineStore.masterGain;
    const audioClips = (
      await toWorkerTimelineClips(effectiveAudioItems, projectStore, workspaceStore, {
        trackKind: 'audio',
      })
    ).map((clip) => ({
      ...clip,
      audioGain: (clip.audioGain ?? 1) * masterGain,
    }));

    const croppedAudioClips = exportRangeUs
      ? audioClips
          .map((clip) => trimWorkerClipToRange(clip, exportRangeUs))
          .filter((clip): clip is WorkerTimelineClip => clip !== null)
      : audioClips;

    if (!croppedVideoClips.length && !croppedAudioClips.length)
      throw new Error('Timeline is empty');

    const { client } = getExportWorkerClient();

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

    try {
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
    }
  }

  async function cancelExport() {
    if (!isExporting.value) return;
    if (cancelRequested.value) return;
    const exportTaskId = activeExportTaskId.value;
    if (!exportTaskId) return;
    cancelRequested.value = true;

    try {
      const { client } = getExportWorkerClient();
      await client.cancelExport(exportTaskId);
    } catch (e) {
      console.warn('Failed to request cooperative export cancel', e);
    }
  }

  return {
    exportTimelineToFile,
    cancelExport,
  };
}
