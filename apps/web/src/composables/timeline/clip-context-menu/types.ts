import type { HotkeyCommandId } from '~/utils/hotkeys/defaultHotkeys';
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
import type { ClipParametersSnapshot } from '~/utils/timeline/clip-parameters';

export interface ContextMenuAction {
  label: string;
  icon: string;
  onSelect: () => void | Promise<void>;
  disabled?: boolean;
  kbds?: string[];
}

export type ContextMenuGroup = ContextMenuAction[];

export interface UseClipContextMenuOptions {
  track: Ref<TimelineTrack>;
  item: Ref<TimelineTrackItem>;
  canEditClipContent: Ref<boolean>;
  timelineDoc: Ref<TimelineDocument | null>;
  projectSettings: Ref<FastCatProjectSettings>;
  defaultTransitionDurationTicks: Ref<number>;
  selectedItemIds: Ref<string[]>;
  currentTime: Ref<number>;
  getHotkeyKbds: (commandId: HotkeyCommandId) => string[] | undefined;
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
  pasteClips: (insertStartTicks?: number) => void;
  hasTimelineClipboard: boolean;
  requestRenameClip: (payload: { trackId: string; itemId: string; name: string }) => void;
  copyClipParameters: (clip: TimelineClipItem, trackKind: TimelineTrack['kind']) => void;
  pasteClipParameters: (clip: TimelineClipItem, trackKind: TimelineTrack['kind']) => void;
  getClipParametersSnapshot: () => ClipParametersSnapshot | null;
  t: (key: string, ...args: (string | number)[]) => string;
}

export interface MultiSelectionItemRef {
  trackId: string;
  itemId: string;
}

export interface MultiSelectionState {
  doc: TimelineDocument | null;
  itemsToUpdate: MultiSelectionItemRef[];
  audioItemsToUpdate: MultiSelectionItemRef[];
  waveformItemsToUpdate: MultiSelectionItemRef[];
  thumbnailItemsToUpdate: MultiSelectionItemRef[];
  autoMontageItemsToUpdate: MultiSelectionItemRef[];
  selectedClips: TimelineClipItem[];
  selectedIds: Set<string>;
  allDisabled: boolean;
  hasGroupedClip: boolean;
  hasLockedTrack: boolean;
  hasAudioOrVideoWithAudio: boolean;
  hasVideo: boolean;
  allMuted: boolean;
  allShowWaveform: boolean;
  allShowThumbnails: boolean;
  allWaveformHalf: boolean;
}
