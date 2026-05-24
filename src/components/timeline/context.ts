import { type ComputedRef, type Ref } from 'vue';
import type {
  TimelineDoc,
  TimelineTrack,
  TimelineTrackItem,
  TimelineTransitionSelection,
  TimelineClipItem,
  TrackKind,
} from '~/timeline/types';
import type { FastCatUserSettings } from '~/utils/settings';

export interface TimelineContext {
  zoom: ComputedRef<number>;
  fps: ComputedRef<number>;
  currentTime: ComputedRef<number>;
  isTrimModeActive: ComputedRef<boolean>;
  selectedItemIds: ComputedRef<string[]>;
  userSettings: ComputedRef<FastCatUserSettings>;
  missingPaths: ComputedRef<Record<string, boolean>>;
  mediaMetadata: ComputedRef<Record<string, any>>;
  clipboardPayload: ComputedRef<any>;
  hasTimelinePayload: ComputedRef<boolean>;
  timelineDoc: ComputedRef<TimelineDoc | null>;
  projectSettings: ComputedRef<any>;
  currentView: ComputedRef<string>;
  toolbarDragModeEnabled: ComputedRef<boolean>;
  toolbarDragMode: ComputedRef<string>;

  // Actions
  updateClipProperties: (trackId: string, itemId: string, props: Record<string, any>, options?: any) => void;
  updateClipTransition: (trackId: string, itemId: string, patch: any, options?: any) => void;
  requestTimelineSave: (options?: any) => Promise<void>;
  splitClipAtTime: (target: { trackId: string; itemId: string }, atUs: number) => void;
  splitClipAtPlayhead: (target: { trackId: string; itemId: string }) => void;
  selectTimelineItems: (items: Array<{ trackId: string; itemId: string }>) => void;
  trimToPlayheadLeftNoRipple: (target: { trackId: string; itemId: string }) => void;
  trimToPlayheadRightNoRipple: (target: { trackId: string; itemId: string }) => void;
  applyTimeline: (cmd: any) => void;
  batchApplyTimeline: (cmds: any[]) => void;
  selectTransition: (payload: TimelineTransitionSelection | null) => void;
  selectTimelineTransition: (trackId: string, itemId: string, edge: 'in' | 'out') => void;
  selectTimelineItem: (trackId: string, itemId: string, kind: 'clip' | 'gap') => void;
  clearSelection: () => void;
  setClipboardPayload: (payload: any) => void;
  triggerScrollToEffects: () => void;
  copySelectedClips: () => any[];
  cutSelectedClips: () => any[];
  pasteClips: (options?: { insertStartUs?: number }) => Promise<void>;

  // Newly added for useClipPropertiesActions
  unlinkAudioFromVideo: (input: { videoItemId?: string; audioTrackId?: string; audioItemId?: string }) => void;
  renameItem: (trackId: string, itemId: string, name: string) => void;
  updateTrackProperties: (trackId: string, patch: Record<string, any>) => void;
  goToFiles: () => void;
  openTimelineFile: (path: string) => Promise<void>;
  goToCut: () => void;
  notifyFileManagerUpdate: () => void;
  triggerScrollToFileTreeEntry: (path: string) => void;
  openFolder: (entry: any) => void;
  selectFsEntry: (entry: any) => void;
  setTempFocus: (panel: 'files-sidebar' | 'files-main') => void;
  setPanelFocus: (panel: string) => void;
  loadProjectDirectory: () => Promise<void>;
  findEntryByPath: (path: string) => any;
  toggleDirectory: (entry: any) => Promise<void>;
  setActiveTab: (tabId: string) => void;

  // Replacement target state
  mediaReplaceTarget: Ref<any>;
  isMediaReplaceModalOpen: Ref<boolean>;
}
