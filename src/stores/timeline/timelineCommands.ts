import type { Ref } from 'vue';
import type { TimelineDocument } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';
import { createTimelineCommandService } from '~/timeline/application/timelineCommandService';
import type { useProjectStore } from '~/stores/project.store';
import type { useMediaStore } from '~/stores/media.store';
import type { useWorkspaceStore } from '~/stores/workspace.store';
import type { useProxyStore } from '~/stores/proxy.store';
import type { useUiStore } from '~/stores/ui.store';
import { parseTimelineFromOtio } from '~/timeline/otioSerializer';
import { selectTimelineDurationUs } from '~/timeline/selectors';
import type { ProxyThumbnailService } from '~/media-cache/application/proxyThumbnailService';

interface CreateTimelineCommandsParams {
  timelineDoc: Ref<TimelineDocument | null>;
  currentTimelinePath: Ref<string | null>;
  mediaMetadata: Ref<Record<string, any>>;
  applyTimeline: (cmd: TimelineCommand, options?: any) => void;
  projectStore: ReturnType<typeof useProjectStore>;
  mediaStore: ReturnType<typeof useMediaStore>;
  workspaceStore: ReturnType<typeof useWorkspaceStore>;
  proxyStore: ReturnType<typeof useProxyStore>;
  uiStore: ReturnType<typeof useUiStore>;
  toast: any;
  t: any;
}

export function createTimelineCommands(params: CreateTimelineCommandsParams) {
  const {
    timelineDoc,
    currentTimelinePath,
    mediaMetadata,
    applyTimeline,
    projectStore,
    mediaStore,
    workspaceStore,
    proxyStore,
    uiStore,
    toast,
    t,
  } = params;

  const commandService = createTimelineCommandService({
    getTimelineDoc: () => timelineDoc.value,
    ensureTimelineDoc: () => {
      if (!timelineDoc.value) {
        timelineDoc.value = projectStore.createFallbackTimelineDoc();
      }
      return timelineDoc.value;
    },
    getCurrentTimelinePath: () => currentTimelinePath.value,
    getTrackById: (trackId) => timelineDoc.value?.tracks.find((t) => t.id === trackId) ?? null,
    applyTimeline,
    getFileHandleByPath: (path) => projectStore.getFileHandleByPath(path),
    getFileByPath: (path) => projectStore.getFileByPath(path),
    getOrFetchMetadataByPath: (path) => mediaStore.getOrFetchMetadataByPath(path),
    getMediaMetadataByPath: (path) => mediaMetadata.value[path] ?? null,
    fetchMediaMetadataByPath: (path) => mediaStore.getOrFetchMetadataByPath(path),
    getUserSettings: () => workspaceStore.userSettings,
    getProjectSettings: () => projectStore.projectSettings,
    updateProjectSettings: async (settings) => {
      const { getResolutionPreset } = await import('~/utils/settings/helpers');
      const preset = getResolutionPreset(settings.width, settings.height);

      Object.assign(projectStore.projectSettings.project, {
        ...settings,
        ...preset,
      });
      await projectStore.saveProjectSettings();
    },
    showFpsWarning: (fileFps, projectFps) => {
      toast.add({
        title: t('videoEditor.timeline.fpsMismatch', 'FPS mismatch'),
        description: t('videoEditor.timeline.fpsMismatchDesc', { fileFps, projectFps }),
        color: 'warning',
        actions: [
          {
            label: t('videoEditor.projectSettings.title'),
            onClick: () => {
              uiStore.isProjectSettingsOpen = true;
            },
          },
        ],
      });
    },
    mediaCache: {
      hasProxy: (path: string) => proxyStore.existingProxies.has(path),
      ensureProxy: async (options: {
        file: File | FileSystemFileHandle;
        projectRelativePath: string;
      }) => await proxyStore.generateProxy(options.file, options.projectRelativePath),
    } satisfies Pick<ProxyThumbnailService, 'hasProxy' | 'ensureProxy'>,
    get defaultImageDurationUs() {
      return workspaceStore.userSettings.timeline.defaultStaticClipDurationUs;
    },
    get defaultImageSourceDurationUs() {
      return workspaceStore.userSettings.timeline.defaultStaticClipDurationUs;
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
