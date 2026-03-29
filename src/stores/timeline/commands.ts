import type { Ref } from 'vue';
import type { TimelineDocument } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';
import { createTimelineCommandService } from '~/timeline/application/timelineCommandService';
import { parseTimelineFromOtio } from '~/timeline/otio-serializer';
import { selectTimelineDurationUs } from '~/timeline/selectors';
import type { ProxyThumbnailService } from '~/media-cache/application/proxyThumbnailService';

export interface TimelineCommandsDeps {
  timelineDoc: Ref<TimelineDocument | null>;
  currentTimelinePath: Ref<string | null>;
  mediaMetadata: Ref<Record<string, any>>;
  applyTimeline: (cmd: TimelineCommand, options?: any) => void;
  createFallbackTimelineDoc: () => TimelineDocument;
  getFileHandleByPath: (path: string) => Promise<FileSystemFileHandle | null>;
  getFileByPath: (path: string) => Promise<File | null>;
  getOrFetchMetadataByPath: (path: string) => Promise<any>;
  getUserSettings: () => any;
  getProjectSettings: () => any;
  updateProjectSettings: (settings: any) => Promise<void>;
  hasProxy: (path: string) => boolean;
  ensureProxy: (options: {
    file: File | FileSystemFileHandle;
    projectRelativePath: string;
  }) => Promise<void>;
  openProjectSettings: () => void;
  toast: any;
  t: any;
}

export function createTimelineCommands(params: TimelineCommandsDeps) {
  const {
    timelineDoc,
    currentTimelinePath,
    mediaMetadata,
    applyTimeline,
    createFallbackTimelineDoc,
    getFileHandleByPath,
    getFileByPath,
    getOrFetchMetadataByPath,
    getUserSettings,
    getProjectSettings,
    updateProjectSettings,
    hasProxy,
    ensureProxy,
    openProjectSettings,
    toast,
    t,
  } = params;

  const commandService = createTimelineCommandService({
    getTimelineDoc: () => timelineDoc.value,
    ensureTimelineDoc: () => {
      if (!timelineDoc.value) {
        timelineDoc.value = createFallbackTimelineDoc();
      }
      return timelineDoc.value;
    },
    getCurrentTimelinePath: () => currentTimelinePath.value,
    getTrackById: (trackId) => timelineDoc.value?.tracks.find((t) => t.id === trackId) ?? null,
    applyTimeline,
    getFileHandleByPath,
    getFileByPath,
    getOrFetchMetadataByPath,
    getMediaMetadataByPath: (path) => mediaMetadata.value[path] ?? null,
    fetchMediaMetadataByPath: getOrFetchMetadataByPath,
    getUserSettings,
    getProjectSettings,
    updateProjectSettings,
    showFpsWarning: (fileFps, projectFps) => {
      toast.add({
        title: t('videoEditor.timeline.fpsMismatch', 'FPS mismatch'),
        description: t('videoEditor.timeline.fpsMismatchDesc', { fileFps, projectFps }),
        color: 'warning',
        actions: [
          {
            label: t('videoEditor.projectSettings.title'),
            onClick: openProjectSettings,
          },
        ],
      });
    },
    mediaCache: {
      hasProxy,
      ensureProxy,
    } satisfies Pick<ProxyThumbnailService, 'hasProxy' | 'ensureProxy'>,
    get defaultImageDurationUs() {
      return getUserSettings().timeline.defaultStaticClipDurationUs;
    },
    get defaultImageSourceDurationUs() {
      return getUserSettings().timeline.defaultStaticClipDurationUs;
    },
    parseTimelineFromOtio,
    selectTimelineDurationUs,
  });

  async function moveItemToTrack(input: {
    fromTrackId: string;
    toTrackId: string;
    itemId: string;
    startUs: number;
  }) {
    await commandService.moveItemToTrack(input);
  }

  async function extractAudioToTrack(input: { videoTrackId: string; videoItemId: string }) {
    await commandService.extractAudioToTrack({
      videoTrackId: input.videoTrackId,
      videoItemId: input.videoItemId,
    });
  }

  function returnAudioToVideo(input: { videoItemId: string }) {
    applyTimeline({ type: 'return_audio_to_video', videoItemId: input.videoItemId });
  }

  async function addClipToTimelineFromPath(
    input: {
      trackId: string;
      name: string;
      path: string;
      startUs?: number;
      pseudo?: boolean;
    },
    options?: {
      historyMode?: 'immediate' | 'debounced';
      historyDebounceMs?: number;
      labelKey?: string;
      skipHistory?: boolean;
      saveMode?: 'none' | 'debounced' | 'immediate';
    },
  ) {
    return await commandService.addClipToTimelineFromPath(input, options);
  }

  async function addTimelineClipToTimelineFromPath(
    input: {
      trackId: string;
      name: string;
      path: string;
      startUs?: number;
      pseudo?: boolean;
    },
    options?: {
      historyMode?: 'immediate' | 'debounced';
      historyDebounceMs?: number;
      labelKey?: string;
      skipHistory?: boolean;
      saveMode?: 'none' | 'debounced' | 'immediate';
    },
  ) {
    if (currentTimelinePath.value && input.path === currentTimelinePath.value) {
      throw new Error('Cannot insert the currently opened timeline into itself');
    }
    return await commandService.addTimelineClipFromPath(input, options);
  }

  return {
    commandService,
    moveItemToTrack,
    extractAudioToTrack,
    returnAudioToVideo,
    addClipToTimelineFromPath,
    addTimelineClipToTimelineFromPath,
  };
}
