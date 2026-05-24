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
  isTrimModeActive: ComputedRef<boolean>;
  selectedItemIds: ComputedRef<string[]>;
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
  applyTimeline: (cmd: TimelineCommand) => string[] | Promise<string[]>;
  batchApplyTimeline: (cmds: TimelineCommand[]) => string[] | Promise<string[]>;
  selectTransition: (payload: TimelineTransitionSelection | null) => void;
  selectTimelineTransition: (trackId: string, itemId: string, edge: 'in' | 'out') => void;
  selectTimelineItem: (trackId: string, itemId: string, kind: 'clip' | 'gap') => void;
  clearSelection: () => void;
  setClipboardPayload: (payload: unknown) => void;
  triggerScrollToEffects: () => void;
  copySelectedClips: () => unknown[];
  cutSelectedClips: () => unknown[];
  pasteClips: (options?: { insertStartUs?: number }) => Promise<unknown>;

  // Newly added for useClipPropertiesActions
  unlinkAudioFromVideo: (input: {
    videoItemId?: string;
    audioTrackId?: string;
    audioItemId?: string;
  }) => void;
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
    expectedType: 'video' | 'image';
  } | null>;
  isMediaReplaceModalOpen: Ref<boolean>;
}
