import type { Ref } from 'vue';
import type {
  ClipTransition,
  TimelineClipItem,
  TimelineDocument,
  TimelineTrack,
  TimelineTrackItem,
} from '~/timeline/types';
import type { TimelineCommand, UpdateClipPropertiesCommand } from '~/timeline/commands';
import type { FastCatProjectSettings } from '~/utils/project-settings';

export interface ContextMenuAction {
  label: string;
  icon: string;
  onSelect: () => void | Promise<void>;
  disabled?: boolean;
}

export type ContextMenuGroup = ContextMenuAction[];

export interface UseClipContextMenuOptions {
  track: Ref<TimelineTrack>;
  item: Ref<TimelineTrackItem>;
  canEditClipContent: Ref<boolean>;
  timelineDoc: Ref<TimelineDocument | null>;
  projectSettings: Ref<FastCatProjectSettings>;
  defaultTransitionDurationUs: Ref<number>;
  selectedItemIds: Ref<string[]>;
  applyTimelineCommand: (cmd: TimelineCommand) => string[];
  batchApplyTimeline: (cmds: TimelineCommand[]) => string[];
  updateClipProperties: (
    trackId: string,
    itemId: string,
    props: UpdateClipPropertiesCommand['properties'],
  ) => string[];
  updateClipTransition: (
    trackId: string,
    itemId: string,
    props: { transitionIn?: ClipTransition | null; transitionOut?: ClipTransition | null },
  ) => string[];
  requestTimelineSave: (opts: { immediate: boolean }) => Promise<void>;
  selectTransition: (payload: { trackId: string; itemId: string; edge: 'in' | 'out' }) => void;
  clearSelection: () => void;
  selectTimelineTransition: (trackId: string, itemId: string, edge: 'in' | 'out') => void;
  emitOpenSpeedModal: (payload: { trackId: string; itemId: string; speed: number }) => void;
  emitClipAction: (payload: import('~/timeline/types').TimelineClipActionPayload) => void;
  copySelectedClips: () => void;
  cutSelectedClips: () => void;
  pasteClips: (insertStartUs?: number) => string[];
  hasTimelineClipboard: boolean;
  t: (key: string, ...args: (string | number)[]) => string;
}

export interface MultiSelectionItemRef {
  trackId: string;
  itemId: string;
}

export interface MultiSelectionState {
  doc: TimelineDocument | null;
  itemsToUpdate: MultiSelectionItemRef[];
  selectedClips: TimelineClipItem[];
  selectedIds: Set<string>;
  selectedVideoIds: string[];
  allDisabled: boolean;
  hasFreeClip: boolean;
  hasGroupedClip: boolean;
  hasLockedLinks: boolean;
  hasLockedTrack: boolean;
  hasAudioOrVideoWithAudio: boolean;
  hasVideo: boolean;
  allMuted: boolean;
  allShowWaveform: boolean;
  allShowThumbnails: boolean;
  allWaveformHalf: boolean;
}
