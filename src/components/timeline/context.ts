import type { ComputedRef, Ref } from 'vue';
import type { TimelineDocument, TimelineTransitionSelection } from '~/timeline/types';
import type { FastCatUserSettings } from '~/utils/settings';
import type { PanelFocusId } from '~/stores/focus.store';
import type { TimelineCommand } from '~/timeline/commands';
import type { FsEntry } from '~/types/fs';

export interface TimelineContext {
  zoom: ComputedRef<number>;
  fps: ComputedRef<number>;
  currentTime: ComputedRef<number>;
  isAnyTrackSoloed: ComputedRef<boolean>;
  isTrimModeActive: ComputedRef<boolean>;
  selectedItemIds: ComputedRef<string[]>;
  /** O(1) membership view of {@link selectedItemIds} for hot per-clip render checks. */
  selectedItemIdSet: ComputedRef<Set<string>>;
  userSettings: ComputedRef<FastCatUserSettings>;
  missingPaths: ComputedRef<Record<string, boolean>>;
  mediaMetadata: ComputedRef<Record<string, unknown>>;
  clipboardPayload: ComputedRef<unknown>;
  hasTimelinePayload: ComputedRef<boolean>;
  timelineDoc: ComputedRef<TimelineDocument | null>;
  projectSettings: ComputedRef<Record<string, unknown>>;
  currentView: ComputedRef<string>;
  toolbarDragModeEnabled: ComputedRef<boolean>;
  toolbarDragMode: ComputedRef<string>;

  // Actions
  /** Move the timeline playhead to an absolute time (µs). */
  setCurrentTimeUs: (timeUs: number) => void;
  updateClipProperties: (
    trackId: string,
    itemId: string,
    props: Record<string, unknown>,
  ) => string[] | Promise<string[]>;
  updateClipTransition: (
    trackId: string,
    itemId: string,
    patch: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => string[] | Promise<string[]>;
  requestTimelineSave: (options?: { immediate?: boolean }) => Promise<void>;
  splitClipAtTime: (target: { trackId: string; itemId: string }, atUs: number) => void;
  splitClipAtPlayhead: (target: { trackId: string; itemId: string }) => void;
  selectTimelineItems: (items: Array<{ trackId: string; itemId: string }>) => void;
  trimToPlayheadLeftNoRipple: (target: { trackId: string; itemId: string }) => void;
  trimToPlayheadRightNoRipple: (target: { trackId: string; itemId: string }) => void;
  trimToTimeLeftNoRipple: (target: { trackId: string; itemId: string }, atUs: number) => void;
  trimToTimeRightNoRipple: (target: { trackId: string; itemId: string }, atUs: number) => void;
  applyTimeline: (cmd: TimelineCommand) => string[] | Promise<string[]>;
  batchApplyTimeline: (
    cmds: TimelineCommand[],
    options?: {
      saveMode?: 'debounced' | 'immediate' | 'none';
      skipHistory?: boolean;
      historyMode?: 'immediate' | 'debounced';
      historyDebounceMs?: number;
      labelKey?: string;
    },
  ) => string[] | Promise<string[]>;
  selectTransition: (payload: TimelineTransitionSelection | null) => void;
  selectTimelineTransition: (trackId: string, itemId: string, edge: 'in' | 'out') => void;
  selectTimelineItem: (trackId: string, itemId: string, kind: 'clip' | 'gap') => void;
  clearSelection: () => void;
  setClipboardPayload: (payload: unknown) => void;
  triggerScrollToEffects: () => void;
  copySelectedClips: () => unknown[];
  cutSelectedClips: () => unknown[];
  pasteClips: (options?: { insertStartUs?: number }) => Promise<unknown>;

  /** Reveal a media clip's source file in the file manager (delegated double-click). */
  revealClipInFileManager: (clip: unknown, trackKind: string) => Promise<void> | void;
  /** Open a nested-timeline clip as the active timeline (delegated double-click). */
  openNestedTimeline: (clip: unknown, trackKind: string) => Promise<void> | void;

  renameItem: (trackId: string, itemId: string, name: string) => void;
  updateTrackProperties: (trackId: string, patch: Record<string, unknown>) => void;
  goToFiles: () => void;
  openTimelineFile: (path: string) => Promise<void>;
  goToCut: () => void;
  notifyFileManagerUpdate: () => void;
  triggerScrollToFileTreeEntry: (path: string) => void;
  openFolder: (entry: FsEntry) => void;
  selectFsEntry: (entry: FsEntry) => void;
  setTempFocus: (panel: 'files-sidebar' | 'files-main') => void;
  setPanelFocus: (panel: PanelFocusId) => void;
  loadProjectDirectory: () => Promise<void>;
  findEntryByPath: (path: string) => FsEntry | null | undefined;
  toggleDirectory: (entry: FsEntry) => Promise<void>;
  setActiveTab: (tabId: string) => void;

  // Replacement target state
  mediaReplaceTarget: Ref<{
    trackId: string;
    itemId: string;
    expectedType: ('audio' | 'video' | 'image')[];
  } | null>;
  isMediaReplaceModalOpen: Ref<boolean>;
}
