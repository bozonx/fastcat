import type { Ref } from 'vue';
import type { TimelineDocument } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';
import { createTimelineCommandService } from '~/timeline/application/timelineCommandService';
import { parseTimelineFromOtio } from '~/timeline/otio-serializer';
import { selectTimelineDurationUs } from '~/timeline/selectors';
import type { ProxyThumbnailService } from '~/media-cache/application/proxyThumbnailService';
import type { TimelineFormatInput } from '~/timeline/format';

export interface TimelineApplyOptions {
  saveMode?: 'debounced' | 'immediate' | 'none';
  skipHistory?: boolean;
  historyMode?: 'immediate' | 'debounced';
  historyDebounceMs?: number;
  labelKey?: string;
}

export interface TimelineCommandsDeps {
  timelineDoc: Ref<TimelineDocument | null>;
  currentTimelinePath: Ref<string | null>;
  mediaMetadata: Ref<Record<string, unknown>>;
  applyTimeline: (cmd: TimelineCommand, options?: TimelineApplyOptions) => string[];
  createFallbackTimelineDoc: () => TimelineDocument;
  getFileHandleByPath: (path: string) => Promise<FileSystemFileHandle | null>;
  getFileByPath: (path: string) => Promise<File | null>;
  getOrFetchMetadataByPath: (path: string) => Promise<unknown>;
  getUserSettings: () => unknown;
  getProjectSettings: () => unknown;
  updateTimelineFormat: (settings: TimelineFormatInput) => Promise<void>;
  hasProxy: (path: string) => boolean;
  ensureProxy: (options: {
    file: File | FileSystemFileHandle;
    projectRelativePath: string;
  }) => Promise<void>;
  openProjectSettings: () => void;
  toast: { add: (opts: unknown) => void };
  t: (key: string, values?: Record<string, unknown>) => string;
}

export interface TimelineCommandsModule {
  commandService: ReturnType<typeof createTimelineCommandService>;
  ensureTimelineDoc: () => TimelineDocument;
  moveItemToTrack: (input: {
    fromTrackId: string;
    toTrackId: string;
    itemId: string;
    startUs: number;
  }) => Promise<void>;
  extractAudioToTrack: (input: { videoTrackId: string; videoItemId: string }) => Promise<void>;
  returnAudioToVideo: (input: { videoItemId: string }) => void;
  unlinkAudioFromVideo: (input: {
    videoItemId?: string;
    audioTrackId?: string;
    audioItemId?: string;
  }) => void;
  addClipToTimelineFromPath: (
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
  ) => Promise<{ durationUs: number; itemId?: string }>;
  addTimelineClipToTimelineFromPath: (
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
  ) => Promise<{ durationUs: number; itemId?: string }>;
}

export function createTimelineCommandsModule(params: TimelineCommandsDeps): TimelineCommandsModule {
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
    updateTimelineFormat,
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
    getOrFetchMetadataByPath: getOrFetchMetadataByPath as (
      path: string,
    ) => Promise<
      import('~/timeline/application/timelineCommandService').TimelineMediaMetadata | null
    >,
    getMediaMetadataByPath: (path) =>
      (mediaMetadata.value[path] ?? null) as
        | import('~/timeline/application/timelineCommandService').TimelineMediaMetadata
        | null,
    fetchMediaMetadataByPath: getOrFetchMetadataByPath as (
      path: string,
    ) => Promise<
      import('~/timeline/application/timelineCommandService').TimelineMediaMetadata | null
    >,
    getUserSettings:
      getUserSettings as () => import('~/utils/settings/defaults').FastCatUserSettings,
    getProjectSettings:
      getProjectSettings as () => import('~/utils/project-settings').FastCatProjectSettings,
    updateTimelineFormat,
    showFpsWarning: (fileFps, projectFps) => {
      toast.add({
        title: t('videoEditor.timeline.fpsMismatch'),
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
    showAutoSettingsApplied: (settings) => {
      toast.add({
        title: t('videoEditor.timeline.autoSettingsApplied'),
        description: t('videoEditor.timeline.autoSettingsAppliedDesc', settings),
        color: 'success',
      });
    },
    mediaCache: {
      hasProxy,
      ensureProxy,
    } satisfies Pick<ProxyThumbnailService, 'hasProxy' | 'ensureProxy'>,
    get defaultImageDurationUs() {
      return (getUserSettings() as import('~/utils/settings/defaults').FastCatUserSettings).timeline
        .defaultStaticClipDurationUs;
    },
    get defaultImageSourceDurationUs() {
      return (getUserSettings() as import('~/utils/settings/defaults').FastCatUserSettings).timeline
        .defaultStaticClipDurationUs;
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

  function unlinkAudioFromVideo(input: {
    videoItemId?: string;
    audioTrackId?: string;
    audioItemId?: string;
  }) {
    applyTimeline({
      type: 'unlink_audio_from_video',
      videoItemId: input.videoItemId,
      audioTrackId: input.audioTrackId,
      audioItemId: input.audioItemId,
    });
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
    ensureTimelineDoc: () => commandService.ensureTimelineDoc(),
    moveItemToTrack,
    extractAudioToTrack,
    returnAudioToVideo,
    unlinkAudioFromVideo,
    addClipToTimelineFromPath,
    addTimelineClipToTimelineFromPath,
  };
}
