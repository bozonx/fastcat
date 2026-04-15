import { computed, type Ref, inject } from 'vue';
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
import { revealFileManagerEntry } from '~/composables/file-manager/revealFileManagerEntry';
import { useAppClipboard } from '~/composables/useAppClipboard';

interface TimelineStoreActions {
  timelineDoc: TimelineDocument | null;
  selectedItemIds: string[];
  fps: number;
  currentTime: number;
  applyTimeline: (cmd: TimelineCommand, options?: any) => string[] | Promise<string[]>;
  batchApplyTimeline: (cmds: TimelineCommand[], options?: any) => string[] | Promise<string[]>;
  loadTimeline: () => Promise<void>;
  loadTimelineMetadata: () => Promise<void> | void;
  updateClipProperties: (trackId: string, itemId: string, patch: Record<string, any>) => any;
  renameItem: (trackId: string, itemId: string, name: string) => void;
  selectTimelineItems: (items: { trackId: string; itemId: string }[]) => void;
  updateTrackProperties: (trackId: string, patch: Record<string, any>) => any;
  deleteFirstSelectedItem: () => void;
  rippleDeleteFirstSelectedItem: () => void;
  pasteClips: (items: any[], options?: { insertStartUs?: number }) => string[];
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
  triggerScrollToFileTreeEntry: (path: string) => void;
  triggerOpenAutoMontage: (itemIds: string[]) => void;
}

interface FilesPageStoreActions {
  openFolder: (entry: FsEntry) => void;
}

interface SelectionStoreActions {
  selectFsEntry: (entry: FsEntry) => void;
  selectTimelineItem: (trackId: string, itemId: string, kind: 'clip' | 'gap') => void;
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

  const { t } = useI18n();
  const clipboardStore = useAppClipboard();

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

  const isSoloed = computed(() => {
    const doc = timelineStore.timelineDoc;
    if (!doc) return false;
    const track = doc.tracks.find((t) => t.id === options.clip.value.trackId);
    return track?.audioSolo === true;
  });

  const hasAudio = computed(() => {
    const clip = options.clip.value;
    return (
      options.trackKind.value === 'audio' ||
      clip.clipType === 'media' ||
      clip.clipType === 'timeline'
    );
  });

  const isMediaVideoClip = computed(() => {
    return options.trackKind.value === 'video' && options.clip.value.clipType === 'media';
  });

  const hasFreezeFrame = computed(() => {
    return typeof options.clip.value.freezeFrameSourceUs === 'number';
  });

  const canExtractAudio = computed(() => {
    return (
      options.trackKind.value === 'video' &&
      options.clip.value.clipType === 'media' &&
      !(options.clip.value as any).audioFromVideoDisabled
    );
  });

  const hasReturnFromVideoClip = computed(() => {
    return options.trackKind.value === 'video' && Boolean(options.clip.value.audioFromVideoDisabled);
  });

  const hasReturnFromLockedAudioClip = computed(() => {
    return (
      options.trackKind.value === 'audio' &&
      Boolean(options.clip.value.linkedVideoClipId) &&
      Boolean(options.clip.value.lockToLinkedVideo)
    );
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
    await revealFileManagerEntry({
      path: normalizeWorkspaceFilePath(clip.source.path),
      beforeReveal: async () => {
        if (projectStore.currentView && projectStore.currentView !== 'files') {
          setActiveTab('files');
        } else {
          projectStore.goToFiles();
        }
      },
      loadProjectDirectory: fileManager.loadProjectDirectory,
      notifyFileManagerUpdate: uiStore.notifyFileManagerUpdate,
      findEntryByPath: fileManager.findEntryByPath,
      toggleDirectory: fileManager.toggleDirectory,
      openFolder: fileManagerStore.openFolder,
      setSelectedFsEntry: (entry) => {
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
      },
      selectEntry: (entry) => selectionStore.selectFsEntry(entry),
      scrollToEntry: (path) => uiStore.triggerScrollToFileTreeEntry(path),
      focusFileManager: () => focusStore.setTempFocus('left'),
    });
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
      expectedType: (clip as any).isImage ? 'image' : 'video',
    };
    uiStore.isMediaReplaceModalOpen = true;
  }

  function handleToggleDisabled() {
    timelineStore.updateClipProperties(options.clip.value.trackId, options.clip.value.id, {
      disabled: !options.clip.value.disabled,
    });
  }

  function handleToggleLocked() {
    timelineStore.updateClipProperties(options.clip.value.trackId, options.clip.value.id, {
      locked: !options.clip.value.locked,
    });
  }

  function handleToggleMuted() {
    timelineStore.updateClipProperties(options.clip.value.trackId, options.clip.value.id, {
      audioMuted: !options.clip.value.audioMuted,
    });
  }

  function handleFreezeFrame() {
    const playheadUs = timelineStore.currentTime;
    const clipStartUs = options.clip.value.timelineRange.startUs;
    const relativeUs = playheadUs - clipStartUs;
    const clampedUs = Math.max(0, Math.min(relativeUs, options.clip.value.timelineRange.durationUs));
    timelineStore.updateClipProperties(options.clip.value.trackId, options.clip.value.id, {
      freezeFrameSourceUs: Math.round(clampedUs),
    });
  }

  function handleResetFreezeFrame() {
    timelineStore.updateClipProperties(options.clip.value.trackId, options.clip.value.id, {
      freezeFrameSourceUs: undefined,
    });
  }

  async function handleExtractAudio() {
    await timelineStore.applyTimeline({
      type: 'extract_audio' as any,
      trackId: options.clip.value.trackId,
      itemId: options.clip.value.id,
    } as any);
  }

  function handleReturnAudio() {
    const clip = options.clip.value;
    if (clip.linkedVideoClipId) {
      timelineStore.applyTimeline({
        type: 'return_audio' as any,
        videoItemId: clip.linkedVideoClipId,
      } as any);
    } else {
      timelineStore.applyTimeline({
        type: 'return_audio' as any,
        videoItemId: clip.id,
      } as any);
    }
  }

  function handlePaste() {
    const payload = clipboardStore.clipboardPayload;
    if (!payload || payload.source !== 'timeline' || payload.items.length === 0) return;
    const playheadUs = timelineStore.currentTime;
    timelineStore.pasteClips(payload.items, { insertStartUs: playheadUs });
    if (payload.operation === 'cut') clipboardStore.setClipboardPayload(null);
  }

  const otherActionsList = computed(() => {
    const list: any[] = [];
    const clip = options.clip.value;

    if (isFreePosition.value) {
      list.push({
        id: 'quantize',
        label: t('fastcat.timeline.quantize'),
        icon: 'i-heroicons-squares-2x2',
        onClick: handleQuantizeClip,
      });
    }

    if (linkedAudioClip.value) {
      list.push({
        id: 'goToLinkedAudio',
        label: t('fastcat.clip.goToLinkedAudio'),
        icon: 'i-heroicons-speaker-wave',
        color: 'primary',
        onClick: goToLinkedAudio,
      });
    }

    if (linkedVideoClip.value) {
      list.push({
        id: 'goToLinkedVideo',
        label: t('fastcat.clip.goToLinkedVideo'),
        icon: 'i-heroicons-film',
        color: 'primary',
        onClick: goToLinkedVideo,
      });
    }

    if (hasLockedLinkedAudio.value || isLockedLinkedAudioClip.value) {
      list.push({
        id: 'unlinkAudio',
        label: t('fastcat.timeline.unlinkAudio'),
        icon: 'i-heroicons-link-slash',
        onClick: handleUnlinkAudio,
      });
    }

    if (isInLinkedGroup.value) {
      list.push({
        id: 'removeFromGroup',
        label: t('fastcat.timeline.removeFromGroup'),
        icon: 'i-heroicons-link-slash',
        onClick: handleRemoveFromGroup,
      });
    }

    if (clip.clipType === 'media') {
      list.push({
        id: 'replaceMedia',
        label: t('fastcat.clip.replaceMedia'),
        icon: 'i-heroicons-arrow-path',
        onClick: handleReplaceMedia,
      });
      list.push({
        id: 'autoMontage',
        label: t('fastcat.timeline.autoMontage.title'),
        icon: 'i-heroicons-sparkles',
        color: 'primary',
        onClick: () => uiStore.triggerOpenAutoMontage([clip.id]),
      });
      list.push({
        id: 'showInFileManager',
        label: t('fastcat.clip.showInFileManager'),
        icon: 'i-heroicons-folder-open',
        onClick: handleSelectInFileManager,
      });
    }

    if (clip.clipType === 'timeline') {
      list.push({
        id: 'goToTimeline',
        label: t('fastcat.clip.goToTimeline'),
        icon: 'i-heroicons-arrow-right-circle',
        onClick: handleOpenNestedTimeline,
      });
    }

    if (hasAudio.value) {
      list.push({
        id: 'toggleAudioWaveformMode',
        label:
          (clip.audioWaveformMode || 'half') === 'full'
            ? t('fastcat.clip.halfWaveform')
            : t('fastcat.clip.fullWaveform'),
        icon: 'i-heroicons-chart-bar',
        onClick: toggleAudioWaveformMode,
      });
    }

    if (options.trackKind.value === 'video' || options.trackKind.value === 'audio') {
      list.push({
        id: 'toggleShowWaveform',
        label:
          clip.showWaveform === false
            ? t('fastcat.clip.showWaveform')
            : t('fastcat.clip.hideWaveform'),
        icon: 'i-heroicons-eye',
        onClick: toggleShowWaveform,
      });
    }

    if (options.trackKind.value === 'video') {
      list.push({
        id: 'toggleShowThumbnails',
        label:
          clip.showThumbnails === false
            ? t('fastcat.clip.showThumbnails')
            : t('fastcat.clip.hideThumbnails'),
        icon: 'i-heroicons-photo',
        onClick: toggleShowThumbnails,
      });
    }

    if (isMediaVideoClip.value && !hasFreezeFrame.value) {
      list.push({
        id: 'freezeFrame',
        label: t('fastcat.timeline.freezeFrame'),
        icon: 'i-heroicons-pause-circle',
        onClick: handleFreezeFrame,
      });
    }

    if (isMediaVideoClip.value && hasFreezeFrame.value) {
      list.push({
        id: 'resetFreezeFrame',
        label: t('fastcat.timeline.resetFreezeFrame'),
        icon: 'i-heroicons-play-circle',
        onClick: handleResetFreezeFrame,
      });
    }

    if (canExtractAudio.value) {
      list.push({
        id: 'extractAudio',
        label: t('fastcat.timeline.extractAudio'),
        icon: 'i-heroicons-musical-note',
        onClick: handleExtractAudio,
      });
    }

    if (hasReturnFromVideoClip.value || hasReturnFromLockedAudioClip.value) {
      list.push({
        id: 'returnAudio',
        label: t('fastcat.timeline.returnAudio'),
        icon: 'i-heroicons-arrow-uturn-left',
        onClick: handleReturnAudio,
      });
    }

    return list;
  });

  const commonActionsList = computed(() => {
    const actions = [
      {
        id: 'delete',
        label: t('common.delete'),
        icon: 'i-heroicons-trash',
        onClick: handleDeleteClip,
      },
      {
        id: 'rename',
        label: t('common.rename'),
        icon: 'i-heroicons-pencil',
        onClick: () => {
          /* Handled in components since it needs a modal state */
        },
      },
      {
        id: 'copy',
        label: t('common.copy'),
        icon: 'i-heroicons-document-duplicate',
        onClick: () => {
          /* Handled in components since it needs clipboard formatting */
        },
      },
      {
        id: 'cut',
        label: t('common.cut'),
        icon: 'i-heroicons-scissors',
        onClick: () => {
          /* Handled in components since it needs clipboard formatting */
        },
      },
      {
        id: 'toggle-disabled',
        label: options.clip.value.disabled
          ? t('fastcat.timeline.enableClip')
          : t('fastcat.timeline.disableClip'),
        icon: options.clip.value.disabled ? 'i-heroicons-eye' : 'i-heroicons-eye-slash',
        onClick: handleToggleDisabled,
      },
    ];

    if (hasAudio.value) {
      actions.push({
        id: 'toggle-muted',
        label: options.clip.value.audioMuted
          ? t('fastcat.timeline.unmuteClip')
          : t('fastcat.timeline.muteClip'),
        icon: options.clip.value.audioMuted ? 'i-heroicons-speaker-wave' : 'i-heroicons-speaker-x-mark',
        onClick: handleToggleMuted,
      });

      actions.push({
        id: 'toggle-solo',
        label: isSoloed.value ? t('fastcat.timeline.unsolo') : t('fastcat.timeline.solo'),
        icon: isSoloed.value ? 'i-heroicons-star-solid' : 'i-heroicons-star',
        onClick: toggleSolo,
      });
    }

    actions.push({
      id: 'toggle-locked',
      label: options.clip.value.locked ? t('fastcat.timeline.unlockClip') : t('fastcat.timeline.lockClip'),
      icon: options.clip.value.locked ? 'i-heroicons-lock-open' : 'i-heroicons-lock-closed',
      onClick: handleToggleLocked,
    });

    return actions;
  });

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
    handleToggleDisabled,
    handleToggleLocked,
    handleToggleMuted,
    handleFreezeFrame,
    handleResetFreezeFrame,
    handleExtractAudio,
    handleReturnAudio,
    handlePaste,
    otherActionsList,
    commonActionsList,
  };
}
