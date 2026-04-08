import { computed, type Ref } from 'vue';
import type {
  TimelineClipItem,
  TrackKind,
  TimelineTrack,
  TimelineDocument,
} from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';
import { quantizeTimeUsToFrames, sanitizeFps } from '~/timeline/commands/utils';
import type { FsEntry } from '~/types/fs';
import { normalizeWorkspaceFilePath } from '~/utils/workspace-common';

interface TimelineStoreActions {
  timelineDoc: TimelineDocument | null;
  selectedItemIds: string[];
  fps: number;
  applyTimeline: (cmd: TimelineCommand, options?: any) => string[] | Promise<string[]>;
  batchApplyTimeline: (cmds: TimelineCommand[], options?: any) => string[] | Promise<string[]>;
  loadTimeline: () => Promise<void>;
  loadTimelineMetadata: () => Promise<void> | void;
  updateClipProperties: (trackId: string, itemId: string, patch: Record<string, any>) => any;
  renameItem: (trackId: string, itemId: string, name: string) => void;
  selectTimelineItems: (items: { trackId: string; itemId: string }[]) => void;
  updateTrackProperties: (trackId: string, patch: Record<string, any>) => any;
}

interface ProjectStoreActions {
  currentView: string;
  projectSettings?: {
    transitions?: {
      defaultDurationUs?: number;
    };
  };
  openTimelineFile: (path: string) => Promise<void>;
  goToFiles: () => void;
  goToCut: () => void;
}

interface UiStoreActions {
  selectedFsEntry: Partial<FsEntry> | null;
  mediaReplaceTarget: { trackId: string; itemId: string; expectedType: 'video' | 'image' } | null;
  isMediaReplaceModalOpen: boolean;
  notifyFileManagerUpdate: () => void;
}

interface FilesPageStoreActions {
  openFolder: (entry: FsEntry) => void;
}

interface SelectionStoreActions {
  selectFsEntry: (entry: FsEntry) => void;
}

interface FocusStoreActions {
  setTempFocus: (panel: 'left' | 'right') => void;
}

interface FileManagerActions {
  loadProjectDirectory: () => Promise<void>;
  findEntryByPath: (path: string) => FsEntry | null | undefined;
  toggleDirectory: (entry: FsEntry) => Promise<void>;
}

interface UseClipPropertiesActionsOptions {
  clip: Ref<TimelineClipItem>;
  trackKind: Ref<TrackKind>;
  timelineStore: TimelineStoreActions;
  projectStore: ProjectStoreActions;
  uiStore: UiStoreActions;
  fileManagerStore: FilesPageStoreActions;
  selectionStore: SelectionStoreActions;
  focusStore: FocusStoreActions;
  fileManager: FileManagerActions;
  setActiveTab: (tabId: string) => void;
}

export function useClipPropertiesActions(options: UseClipPropertiesActionsOptions) {
  const {
    timelineStore,
    projectStore,
    fileManager,
    uiStore,
    selectionStore,
    fileManagerStore,
    focusStore,
    setActiveTab,
  } = options;

  const isFreePosition = computed(() => {
    const doc = timelineStore.timelineDoc;
    if (!doc) return false;
    const safeFps =
      typeof timelineStore.fps === 'number' && timelineStore.fps > 0 ? timelineStore.fps : 30;

    const startFrame = (options.clip.value.timelineRange.startUs * safeFps) / 1_000_000;
    const durFrame = (options.clip.value.timelineRange.durationUs * safeFps) / 1_000_000;

    const isStartQuantized = Math.abs(startFrame - Math.round(startFrame)) < 0.001;
    const isDurationQuantized = Math.abs(durFrame - Math.round(durFrame)) < 0.001;

    return !isStartQuantized || !isDurationQuantized;
  });

  const hasLockedLinkedAudio = computed(() => {
    const doc = timelineStore.timelineDoc;
    if (!doc) return false;
    if (options.trackKind.value !== 'video') return false;
    return doc.tracks
      .filter((t: TimelineTrack) => t.kind === 'audio')
      .some((t: TimelineTrack) =>
        t.items.some(
          (it) =>
            it.kind === 'clip' &&
            Boolean((it as TimelineClipItem).linkedVideoClipId) &&
            Boolean((it as TimelineClipItem).lockToLinkedVideo) &&
            String((it as TimelineClipItem).linkedVideoClipId) === options.clip.value.id,
        ),
      );
  });

  const isLockedLinkedAudioClip = computed(() => {
    if (options.trackKind.value !== 'audio') return false;
    const clip = options.clip.value as TimelineClipItem;
    return Boolean(clip.linkedVideoClipId) && Boolean(clip.lockToLinkedVideo);
  });

  const isInLinkedGroup = computed(
    () =>
      typeof options.clip.value.linkedGroupId === 'string' &&
      options.clip.value.linkedGroupId.trim().length > 0,
  );

  const linkedAudioClip = computed(() => {
    const doc = timelineStore.timelineDoc;
    if (!doc || options.trackKind.value !== 'video') return null;
    for (const track of doc.tracks) {
      if (track.kind !== 'audio') continue;
      for (const item of track.items) {
        if (
          item.kind === 'clip' &&
          (item as TimelineClipItem).linkedVideoClipId === options.clip.value.id
        ) {
          return item as TimelineClipItem;
        }
      }
    }
    return null;
  });

  const linkedVideoClip = computed(() => {
    const doc = timelineStore.timelineDoc;
    if (!doc || options.trackKind.value !== 'audio') return null;
    const videoId = options.clip.value.linkedVideoClipId;
    if (!videoId) return null;
    for (const track of doc.tracks) {
      if (track.kind !== 'video') continue;
      for (const item of track.items) {
        if (item.kind === 'clip' && item.id === videoId) {
          return item as TimelineClipItem;
        }
      }
    }
    return null;
  });

  function goToLinkedAudio() {
    if (linkedAudioClip.value) {
      timelineStore.selectTimelineItems([
        { trackId: linkedAudioClip.value.trackId, itemId: linkedAudioClip.value.id },
      ]);
    }
  }

  function goToLinkedVideo() {
    if (linkedVideoClip.value) {
      timelineStore.selectTimelineItems([
        { trackId: linkedVideoClip.value.trackId, itemId: linkedVideoClip.value.id },
      ]);
    }
  }

  function handleDeleteClip() {
    timelineStore.applyTimeline({
      type: 'delete_items',
      trackId: options.clip.value.trackId,
      itemIds: [options.clip.value.id],
    });

    if (Array.isArray(timelineStore.selectedItemIds)) {
      timelineStore.selectedItemIds = timelineStore.selectedItemIds.filter(
        (itemId: string) => itemId !== options.clip.value.id,
      );
    }
  }

  function handleUnlinkAudio() {
    const doc = timelineStore.timelineDoc;
    if (!doc) return;

    if (isLockedLinkedAudioClip.value) {
      timelineStore.updateClipProperties(options.clip.value.trackId, options.clip.value.id, {
        linkedVideoClipId: undefined,
        lockToLinkedVideo: false,
      });
      return;
    }

    if (options.trackKind.value === 'video') {
      const cmds = doc.tracks
        .filter((t: TimelineTrack) => t.kind === 'audio')
        .flatMap((t: TimelineTrack) => t.items)
        .filter(
          (it): it is TimelineClipItem =>
            it.kind === 'clip' &&
            Boolean((it as TimelineClipItem).linkedVideoClipId) &&
            Boolean((it as TimelineClipItem).lockToLinkedVideo) &&
            String((it as TimelineClipItem).linkedVideoClipId) === options.clip.value.id,
        )
        .map((a: TimelineClipItem) => ({
          type: 'update_clip_properties' as const,
          trackId: a.trackId,
          itemId: a.id,
          properties: {
            linkedVideoClipId: undefined,
            lockToLinkedVideo: false,
          },
        }));
      if (cmds.length === 0) return;
      timelineStore.batchApplyTimeline(cmds);
    }
  }

  function handleQuantizeClip() {
    const doc = timelineStore.timelineDoc;
    const clip = options.clip.value;
    if (!doc) return;

    const fps = sanitizeFps(doc.timebase?.fps);
    const startUs = quantizeTimeUsToFrames(clip.timelineRange.startUs, fps, 'round');
    const endUs = quantizeTimeUsToFrames(
      clip.timelineRange.startUs + clip.timelineRange.durationUs,
      fps,
      'round',
    );
    const durationUs = Math.max(1, endUs - startUs);

    timelineStore.applyTimeline({
      type: 'move_item',
      trackId: clip.trackId,
      itemId: clip.id,
      startUs,
      quantizeToFrames: false,
    });

    timelineStore.applyTimeline({
      type: 'trim_item',
      trackId: clip.trackId,
      itemId: clip.id,
      edge: 'end',
      deltaUs: durationUs - clip.timelineRange.durationUs,
      quantizeToFrames: false,
    });
  }

  function handleRemoveFromGroup() {
    if (!isInLinkedGroup.value) return;

    timelineStore.updateClipProperties(options.clip.value.trackId, options.clip.value.id, {
      linkedGroupId: undefined,
    });
  }

  const isSoloed = computed(() => {
    const doc = timelineStore.timelineDoc;
    if (!doc) return false;
    const track = doc.tracks.find((t) => t.id === options.clip.value.trackId);
    return track?.audioSolo === true;
  });

  function toggleSolo() {
    timelineStore.updateTrackProperties(options.clip.value.trackId, {
      audioSolo: !isSoloed.value,
    });
  }

  function toggleAudioWaveformMode() {
    const current = options.clip.value.audioWaveformMode || 'half';
    timelineStore.updateClipProperties(options.clip.value.trackId, options.clip.value.id, {
      audioWaveformMode: current === 'half' ? 'full' : 'half',
    });
  }

  function toggleShowWaveform() {
    const current = options.clip.value.showWaveform !== false;
    timelineStore.updateClipProperties(options.clip.value.trackId, options.clip.value.id, {
      showWaveform: !current,
    });
  }

  function toggleShowThumbnails() {
    const current = options.clip.value.showThumbnails !== false;
    timelineStore.updateClipProperties(options.clip.value.trackId, options.clip.value.id, {
      showThumbnails: !current,
    });
  }

  function handleRenameClip(newName: string) {
    if (newName.trim()) {
      timelineStore.renameItem(options.clip.value.trackId, options.clip.value.id, newName.trim());
    }
  }

  async function handleSelectInFileManager() {
    const clip = options.clip.value;
    if (clip.clipType !== 'media' || !clip.source?.path) return;
    const path = normalizeWorkspaceFilePath(clip.source.path);
    const parentPath = path.split('/').slice(0, -1).join('/');

    if (projectStore.currentView && projectStore.currentView !== 'files') {
      setActiveTab('files');
    } else {
      projectStore.goToFiles();
    }

    await fileManager.loadProjectDirectory();
    uiStore.notifyFileManagerUpdate();

    const parts = path.split('/').filter(Boolean);
    let currentPath = '';
    for (let i = 0; i < parts.length - 1; i += 1) {
      const p = parts[i];
      if (!p) continue;
      currentPath = currentPath ? `${currentPath}/${p}` : p;
      const dirEntry = fileManager.findEntryByPath(currentPath);
      if (dirEntry && dirEntry.kind === 'directory' && !dirEntry.expanded) {
        await fileManager.toggleDirectory(dirEntry);
      }
    }

    const entry = fileManager.findEntryByPath(path);
    if (!entry) return;

    if (parentPath) {
      const parentEntry = fileManager.findEntryByPath(parentPath);
      if (parentEntry && parentEntry.kind === 'directory') {
        fileManagerStore.openFolder(parentEntry);
      }
    }

    uiStore.selectedFsEntry = {
      kind: entry.kind,
      name: entry.name,
      path: entry.path,
      parentPath: entry.parentPath,
      lastModified: entry.lastModified,
      size: entry.size,
      source: entry.source,
      remoteId: entry.remoteId,
      remotePath: entry.remotePath,
      adapterPayload: entry.adapterPayload,
    };
    selectionStore.selectFsEntry(entry);

    focusStore.setTempFocus('left');
  }

  async function handleOpenNestedTimeline() {
    const clip = options.clip.value;
    if (clip.clipType !== 'timeline' || !clip.source?.path) return;
    const timelinePath = normalizeWorkspaceFilePath(clip.source.path);
    if (!timelinePath.toLowerCase().endsWith('.otio')) return;
    await projectStore.openTimelineFile(timelinePath);
    await timelineStore.loadTimeline();
    void timelineStore.loadTimelineMetadata();
    projectStore.goToCut();
  }

  function handleReplaceMedia() {
    const clip = options.clip.value;
    if (clip.clipType !== 'media') return;
    uiStore.mediaReplaceTarget = {
      trackId: clip.trackId,
      itemId: clip.id,
      expectedType: clip.isImage ? 'image' : 'video',
    };
    uiStore.isMediaReplaceModalOpen = true;
  }

  return {
    isFreePosition,
    hasLockedLinkedAudio,
    isLockedLinkedAudioClip,
    isInLinkedGroup,
    handleDeleteClip,
    handleUnlinkAudio,
    handleQuantizeClip,
    handleRemoveFromGroup,
    toggleAudioWaveformMode,
    toggleShowWaveform,
    toggleShowThumbnails,
    handleRenameClip,
    handleSelectInFileManager,
    handleOpenNestedTimeline,
    goToLinkedAudio,
    goToLinkedVideo,
    linkedAudioClip,
    linkedVideoClip,
    isSoloed,
    toggleSolo,
    handleReplaceMedia,
  };
}
