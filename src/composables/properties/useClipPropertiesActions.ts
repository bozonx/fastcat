import { computed, type Ref } from 'vue';
import type { TimelineClipItem, TrackKind, TimelineDocument } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';
import type { TimelineClipClipboardItem } from '~/stores/timeline/clips';
import { quantizeTimeUsToFrames, sanitizeFps } from '~/timeline/commands/utils';
import type { FsEntry } from '~/types/fs';
import { normalizeWorkspaceFilePath } from '~/utils/workspace-common';
import { revealFileManagerEntry } from '~/composables/file-manager/revealFileManagerEntry';
import { useAppClipboard } from '~/composables/useAppClipboard';
import { getApplicableClipParameterGroups } from '~/utils/timeline/clip-parameters';
import { isClipFrameAligned, clipSupportsSpeedControls } from '~/utils/timeline/clip-capabilities';

interface TimelineStoreActions {
  timelineDoc: TimelineDocument | null;
  selectedItemIds: string[];
  fps: number;
  currentTime: number;
  applyTimeline: (
    cmd: TimelineCommand,
    options?: { labelKey?: string },
  ) => string[] | Promise<string[]>;
  batchApplyTimeline: (
    cmds: TimelineCommand[],
    options?: { labelKey?: string },
  ) => string[] | Promise<string[]>;
  loadTimeline: () => Promise<void>;
  loadTimelineMetadata: () => Promise<void> | void;
  updateClipProperties: (trackId: string, itemId: string, patch: Record<string, unknown>) => void;

  renameItem: (trackId: string, itemId: string, name: string) => void;
  selectTimelineItems: (items: { trackId: string; itemId: string }[]) => void;
  updateTrackProperties: (trackId: string, patch: Record<string, unknown>) => void;
  deleteFirstSelectedItem: () => void;
  rippleDeleteFirstSelectedItem: () => void;
  pasteClips: (
    items: TimelineClipClipboardItem[],
    options?: { insertStartUs?: number },
  ) => Promise<{ trackId: string; itemId: string }[]>;
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
  setTempFocus: (panel: 'files-sidebar' | 'files-main') => void;
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

    return !isClipFrameAligned(options.clip.value, safeFps);
  });

  const isInLinkedGroup = computed(
    () =>
      typeof options.clip.value.linkedGroupId === 'string' &&
      options.clip.value.linkedGroupId.trim().length > 0,
  );

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

  const hasApplicableClipParameters = computed(() => {
    const payload = clipboardStore.clipboardPayload;
    if (!payload || payload.source !== 'clipParameters') return false;
    return (
      getApplicableClipParameterGroups({
        snapshot: payload.snapshot,
        targetClip: options.clip.value,
        targetTrackKind: options.trackKind.value,
      }).length > 0
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
      !options.clip.value.isImage &&
      !options.clip.value.audioMuted
    );
  });

  function handleDeleteClip() {
    const clipId = options.clip.value?.id;
    const trackId = options.clip.value?.trackId;
    if (!clipId || !trackId) return;

    timelineStore.applyTimeline({
      type: 'delete_items',
      trackId,
      itemIds: [clipId],
    });

    if (Array.isArray(timelineStore.selectedItemIds)) {
      timelineStore.selectedItemIds = timelineStore.selectedItemIds.filter(
        (itemId: string) => itemId !== clipId,
      );
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
      focusFileManager: () => focusStore.setTempFocus('files-sidebar'),
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
      expectedType: clip.isImage ? 'image' : 'video',
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
    const clampedUs = Math.max(
      0,
      Math.min(relativeUs, options.clip.value.timelineRange.durationUs),
    );
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
      type: 'extract_audio_to_track',
      videoTrackId: options.clip.value.trackId,
      videoItemId: options.clip.value.id,
    });
  }

  function handlePaste() {
    const payload = clipboardStore.clipboardPayload;
    if (!payload || payload.source !== 'timeline' || payload.items.length === 0) return;
    const playheadUs = timelineStore.currentTime;
    void timelineStore.pasteClips(payload.items, { insertStartUs: playheadUs });
    if (payload.operation === 'cut') clipboardStore.setClipboardPayload(null);
  }

  const otherActionsList = computed(() => {
    const list: {
      label: string;
      icon: string;
      id: string;
      onClick: () => void;
      onSelect?: () => void;
      color?:
        | 'neutral'
        | 'error'
        | 'success'
        | 'warning'
        | 'info'
        | 'primary'
        | 'secondary'
        | 'danger';
      disabled?: boolean;
    }[] = [];
    const clip = options.clip.value;

    if (isFreePosition.value) {
      list.push({
        id: 'quantize',
        label: t('fastcat.timeline.quantize'),
        icon: 'i-heroicons-squares-2x2',
        onClick: handleQuantizeClip,
      });
    }

    list.push({
      id: 'copy-parameters',
      label: t('fastcat.clip.parameters.copy'),
      icon: 'i-heroicons-clipboard-document',
      onClick: () => {
        /* Handled in components since it needs clipboard formatting */
      },
    });

    list.push({
      id: 'paste-parameters',
      label: t('fastcat.clip.parameters.paste'),
      icon: 'i-heroicons-clipboard-document-check',
      disabled: !hasApplicableClipParameters.value || options.clip.value.locked,
      onClick: () => {
        /* Handled in components since it needs modal state */
      },
    });

    if (clipSupportsSpeedControls({ kind: options.trackKind.value }, clip)) {
      list.push({
        id: 'reverse-speed',
        label: t('videoEditor.audio.reverse'),
        icon: 'i-heroicons-arrow-path',
        onClick: () => {
          const currentSpeed = typeof clip.speed === 'number' ? clip.speed : 1;
          timelineStore.updateClipProperties(clip.trackId, clip.id, {
            speed: -currentSpeed,
          });
        },
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
            ? t('fastcat.clip.showHalfWaveform')
            : t('fastcat.clip.showFullWaveform'),
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

    return list;
  });

  const commonActionsList = computed(() => {
    const actions: Array<{
      id: string;
      label: string;
      icon: string;
      onClick: () => void;
      color?:
        | 'neutral'
        | 'error'
        | 'success'
        | 'warning'
        | 'info'
        | 'primary'
        | 'secondary'
        | 'danger';
      variant?: 'solid' | 'outline' | 'soft' | 'ghost' | 'subtle' | 'link';
    }> = [
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
        color: options.clip.value.disabled ? 'warning' : 'neutral',
        variant: options.clip.value.disabled ? 'solid' : 'ghost',
        onClick: handleToggleDisabled,
      },
    ];

    if (hasAudio.value) {
      actions.push({
        id: 'toggle-muted',
        label: options.clip.value.audioMuted
          ? t('fastcat.timeline.unmuteClip')
          : t('fastcat.timeline.muteClip'),
        icon: options.clip.value.audioMuted
          ? 'i-heroicons-speaker-wave'
          : 'i-heroicons-speaker-x-mark',
        color: options.clip.value.audioMuted ? 'error' : 'neutral',
        variant: options.clip.value.audioMuted ? 'solid' : 'ghost',
        onClick: handleToggleMuted,
      });
    }

    actions.push({
      id: 'toggle-locked',
      label: options.clip.value.locked
        ? t('fastcat.timeline.unlockClip')
        : t('fastcat.timeline.lockClip'),
      icon: options.clip.value.locked ? 'i-heroicons-lock-open' : 'i-heroicons-lock-closed',
      color: options.clip.value.locked ? 'primary' : 'neutral',
      variant: options.clip.value.locked ? 'solid' : 'ghost',
      onClick: handleToggleLocked,
    });

    return actions;
  });

  return {
    isFreePosition,
    isInLinkedGroup,
    handleDeleteClip,
    handleQuantizeClip,
    handleRemoveFromGroup,
    toggleAudioWaveformMode,
    toggleShowWaveform,
    toggleShowThumbnails,
    handleRenameClip,
    handleSelectInFileManager,
    handleOpenNestedTimeline,
    isSoloed,
    toggleSolo,
    handleReplaceMedia,
    handleToggleDisabled,
    handleToggleLocked,
    handleToggleMuted,
    handleFreezeFrame,
    handleResetFreezeFrame,
    handleExtractAudio,
    handlePaste,
    otherActionsList,
    commonActionsList,
  };
}
