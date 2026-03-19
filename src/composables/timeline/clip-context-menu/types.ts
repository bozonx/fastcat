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
  applyTimelineCommand: (cmd: TimelineCommand) => void;
  batchApplyTimeline: (cmds: TimelineCommand[]) => void;
  updateClipProperties: (
    trackId: string,
    itemId: string,
    props: UpdateClipPropertiesCommand['properties'],
  ) => void;
  updateClipTransition: (
    trackId: string,
    itemId: string,
    props: { transitionIn?: ClipTransition | null; transitionOut?: ClipTransition | null },
  ) => void;
  requestTimelineSave: (opts: { immediate: boolean }) => Promise<void>;
  selectTransition: (payload: { trackId: string; itemId: string; edge: 'in' | 'out' }) => void;
  clearSelection: () => void;
  selectTimelineTransition: (trackId: string, itemId: string, edge: 'in' | 'out') => void;
  emitOpenSpeedModal: (payload: { trackId: string; itemId: string; speed: number }) => void;
  emitClipAction: (payload: {
    action: 'extractAudio' | 'returnAudio' | 'freezeFrame' | 'resetFreezeFrame';
    trackId: string;
    itemId: string;
    videoItemId?: string;
  }) => void;
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
  hasLockedLinks: boolean;
  hasAudioOrVideoWithAudio: boolean;
  hasVideo: boolean;
  allMuted: boolean;
  allShowWaveform: boolean;
  allShowThumbnails: boolean;
  allWaveformHalf: boolean;
}
