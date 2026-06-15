import { computed, provide, ref } from 'vue';
import { useClipPropertiesActions } from '~/composables/properties/useClipPropertiesActions';
import type { TimelineClipItem, TrackKind } from '~/timeline/types';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useMediaStore } from '~/stores/media.store';
import { useProjectStore } from '~/stores/project.store';
import { useProjectTabsStore } from '~/stores/project-tabs.store';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { useTimelineSettingsStore } from '~/stores/timeline-settings.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useFocusStore, type PanelFocusId } from '~/stores/focus.store';
import { useUiStore } from '~/stores/ui.store';
import { useAppClipboard } from '~/composables/useAppClipboard';
import type { AppClipboardPayload } from '~/stores/clipboard.store';
import type { TimelineCommand } from '~/timeline/commands';
import type { FsEntry } from '~/types/fs';
import type { TimelineContext } from '~/components/timeline/context';

/**
 * Builds and `provide`s the {@link TimelineContext} consumed by descendant
 * timeline components (clips, gaps, transition panels…).
 *
 * This is pure store-to-context glue that previously lived inline in
 * `TimelineTracks.vue`. Must be called from a component `setup` so `provide`
 * binds to the right instance.
 */
export function useProvideTimelineContext() {
  const timelineStore = useTimelineStore();
  const selectionStore = useSelectionStore();
  const mediaStore = useMediaStore();
  const projectStore = useProjectStore();
  const projectTabsStore = useProjectTabsStore();
  const fileManagerStore = useFileManagerStore();
  const fileManager = useFileManager();
  const settingsStore = useTimelineSettingsStore();
  const workspaceStore = useWorkspaceStore();
  const focusStore = useFocusStore();
  const uiStore = useUiStore();
  const clipboardStore = useAppClipboard();

  // A single shared clip-properties-actions instance for delegated clip double-clicks.
  // Building this per visible clip span up a `useFileManager()` watcher each; here it is
  // created once. The target clip is set transiently right before each handler runs.
  const dblClickClip = ref<TimelineClipItem | null>(null);
  const dblClickTrackKind = ref<TrackKind>('video');
  const clipDblClickActions = useClipPropertiesActions({
    clip: computed(() => dblClickClip.value!),
    trackKind: computed(() => dblClickTrackKind.value),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    timelineStore: timelineStore as any,
    projectStore,
    uiStore,
    fileManagerStore,
    selectionStore,
    focusStore,
    fileManager,
    setActiveTab: (tabId: string) => projectTabsStore.setActiveTab(tabId),
  });

  provide<TimelineContext>('timelineContext', {
    zoom: computed(() => timelineStore.timelineZoom),
    fps: computed(() => timelineStore.fps),
    currentTime: computed(() => timelineStore.currentTime),
    isTrimModeActive: computed(() => timelineStore.isTrimModeActive),
    selectedItemIds: computed(() => timelineStore.selectedItemIds),
    selectedItemIdSet: computed(() => new Set(timelineStore.selectedItemIds)),
    userSettings: computed(() => workspaceStore.userSettings),
    missingPaths: computed(() => mediaStore.missingPaths),
    mediaMetadata: computed(() => mediaStore.mediaMetadata),
    clipboardPayload: computed(() => clipboardStore.clipboardPayload),
    hasTimelinePayload: computed(() => clipboardStore.hasTimelinePayload),
    timelineDoc: computed(() => timelineStore.timelineDoc),
    projectSettings: computed(() => projectStore?.projectSettings ?? {}),
    currentView: computed(() => projectStore?.currentView ?? ''),
    toolbarDragModeEnabled: computed(() => settingsStore.toolbarDragModeEnabled),
    toolbarDragMode: computed(() => settingsStore.toolbarDragMode),

    updateClipProperties: (trackId: string, itemId: string, props: Record<string, unknown>) =>
      timelineStore.updateClipProperties(trackId, itemId, props),
    updateClipTransition: (
      trackId: string,
      itemId: string,
      patch: Record<string, unknown>,
      options?: Record<string, unknown>,
    ) => timelineStore.updateClipTransition(trackId, itemId, patch, options),
    requestTimelineSave: (options?: { immediate?: boolean }) =>
      timelineStore.requestTimelineSave(options),
    splitClipAtTime: (target: { trackId: string; itemId: string }, atUs: number) =>
      timelineStore.splitClipAtTime(target, atUs),
    splitClipAtPlayhead: (target: { trackId: string; itemId: string }) =>
      timelineStore.splitClipAtPlayhead(target),
    selectTimelineItems: (items: Array<{ trackId: string; itemId: string }>) =>
      timelineStore.selectTimelineItems(items),
    trimToPlayheadLeftNoRipple: (target: { trackId: string; itemId: string }) =>
      timelineStore.trimToPlayheadLeftNoRipple(target),
    trimToPlayheadRightNoRipple: (target: { trackId: string; itemId: string }) =>
      timelineStore.trimToPlayheadRightNoRipple(target),
    trimToTimeLeftNoRipple: (target: { trackId: string; itemId: string }, atUs: number) =>
      timelineStore.trimToTimeLeftNoRipple(target, atUs),
    trimToTimeRightNoRipple: (target: { trackId: string; itemId: string }, atUs: number) =>
      timelineStore.trimToTimeRightNoRipple(target, atUs),
    applyTimeline: (cmd: TimelineCommand) => timelineStore.applyTimeline(cmd),
    batchApplyTimeline: (cmds: TimelineCommand[]) => timelineStore.batchApplyTimeline(cmds),
    selectTransition: (payload: { trackId: string; itemId: string; edge: 'in' | 'out' } | null) =>
      timelineStore.selectTransition(payload),
    selectTimelineTransition: (trackId: string, itemId: string, edge: 'in' | 'out') =>
      selectionStore.selectTimelineTransition(trackId, itemId, edge),
    selectTimelineItem: (trackId: string, itemId: string, kind: 'clip' | 'gap') =>
      selectionStore.selectTimelineItem(trackId, itemId, kind),
    clearSelection: () => selectionStore.clearSelection(),
    setClipboardPayload: (payload: unknown) =>
      clipboardStore.setClipboardPayload(payload as AppClipboardPayload | null),
    triggerScrollToEffects: () => uiStore.triggerScrollToEffects(),
    copySelectedClips: () => timelineStore.copySelectedClips() || [],
    cutSelectedClips: () => timelineStore.cutSelectedClips() || [],
    pasteClips: (options?: { insertStartUs?: number }) =>
      timelineStore.pasteClips(
        clipboardStore.clipboardPayload?.source === 'timeline'
          ? clipboardStore.clipboardPayload.items
          : [],
        options,
      ),

    revealClipInFileManager: (clip: unknown, trackKind: string) => {
      dblClickClip.value = clip as TimelineClipItem;
      dblClickTrackKind.value = trackKind as TrackKind;
      return clipDblClickActions.handleSelectInFileManager();
    },
    openNestedTimeline: (clip: unknown, trackKind: string) => {
      dblClickClip.value = clip as TimelineClipItem;
      dblClickTrackKind.value = trackKind as TrackKind;
      return clipDblClickActions.handleOpenNestedTimeline();
    },

    renameItem: (trackId: string, itemId: string, name: string) =>
      timelineStore.renameItem(trackId, itemId, name),
    updateTrackProperties: (trackId: string, patch: Record<string, unknown>) =>
      timelineStore.updateTrackProperties(trackId, patch),
    goToFiles: () => projectStore.goToFiles(),
    openTimelineFile: (path: string) => projectStore.openTimelineFile(path),
    goToCut: () => projectStore.goToCut(),
    notifyFileManagerUpdate: () => uiStore.notifyFileManagerUpdate(),
    triggerScrollToFileTreeEntry: (path: string) => uiStore.triggerScrollToFileTreeEntry(path),
    openFolder: (entry: FsEntry) => fileManagerStore.openFolder(entry),
    selectFsEntry: (entry: FsEntry) => selectionStore.selectFsEntry(entry),
    setTempFocus: (panel: 'files-sidebar' | 'files-main') => focusStore.setTempFocus(panel),
    setPanelFocus: (panel: PanelFocusId) => focusStore.setPanelFocus(panel),
    loadProjectDirectory: () => fileManager.loadProjectDirectory(),
    findEntryByPath: (path: string) => fileManager.findEntryByPath(path),
    toggleDirectory: (entry: FsEntry) => fileManager.toggleDirectory(entry),
    setActiveTab: (tabId: string) => projectTabsStore.setActiveTab(tabId),

    mediaReplaceTarget: computed({
      get: () => uiStore.mediaReplaceTarget,
      set: (val) => {
        uiStore.mediaReplaceTarget = val;
      },
    }),
    isMediaReplaceModalOpen: computed({
      get: () => uiStore.isMediaReplaceModalOpen,
      set: (val) => {
        uiStore.isMediaReplaceModalOpen = val;
      },
    }),
  });
}
