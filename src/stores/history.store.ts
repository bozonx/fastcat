import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import type { TimelineDocument } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';

const MAX_HISTORY_SIZE = 100;

export interface HistoryEntry {
  id: number;
  labelKey: string;
  commandType: TimelineCommand['type'];
  /** Snapshot of the timeline document BEFORE the command was applied */
  snapshot: TimelineDocument;
  timestamp: number;
}

let entryIdCounter = 0;

const COMMAND_LABEL_KEYS: Record<TimelineCommand['type'], string> = {
  add_clip_to_track: 'videoEditor.fileManager.history.entries.addClip',
  add_virtual_clip_to_track: 'videoEditor.fileManager.history.entries.addClip',
  remove_item: 'videoEditor.fileManager.history.entries.removeItem',
  delete_items: 'videoEditor.fileManager.history.entries.deleteItems',
  move_item: 'videoEditor.fileManager.history.entries.moveItem',
  move_items: 'videoEditor.fileManager.history.entries.moveItems',
  move_item_to_track: 'videoEditor.fileManager.history.entries.moveItem',
  trim_item: 'videoEditor.fileManager.history.entries.trimClip',
  overlay_trim_item: 'videoEditor.fileManager.history.entries.trimClip',
  overlay_place_item: 'videoEditor.fileManager.history.entries.placeClip',
  split_item: 'videoEditor.fileManager.history.entries.splitClip',
  rename_item: 'videoEditor.fileManager.history.entries.renameClip',
  update_clip_properties: 'videoEditor.fileManager.history.entries.updateClip',
  update_clip_transition: 'videoEditor.fileManager.history.entries.updateTransition',
  add_marker: 'videoEditor.fileManager.history.entries.addMarker',
  update_marker: 'videoEditor.fileManager.history.entries.updateMarker',
  remove_marker: 'videoEditor.fileManager.history.entries.removeMarker',
  add_track: 'videoEditor.fileManager.history.entries.addTrack',
  rename_track: 'videoEditor.fileManager.history.entries.renameTrack',
  delete_track: 'videoEditor.fileManager.history.entries.deleteTrack',
  reorder_tracks: 'videoEditor.fileManager.history.entries.reorderTracks',
  update_track_properties: 'videoEditor.fileManager.history.entries.updateTrack',
  extract_audio_to_track: 'videoEditor.fileManager.history.entries.extractAudio',
  return_audio_to_video: 'videoEditor.fileManager.history.entries.returnAudio',
  update_master_gain: 'videoEditor.fileManager.history.entries.updateMasterGain',
  update_master_muted: 'videoEditor.fileManager.history.entries.toggleMute',
  update_master_effects: 'videoEditor.fileManager.history.entries.updateEffects',
  update_timeline_properties: 'videoEditor.fileManager.history.entries.updateTimelineProperties',
};

const MULTIPLE_ACTIONS_LABEL_KEY = 'videoEditor.fileManager.history.entries.multipleActions';

export const useHistoryStore = defineStore('history', () => {
  /** Past states: index 0 is the oldest, last is the most recent undo target */
  const past = ref<HistoryEntry[]>([]);
  /** Future states available for redo, index 0 is the next redo */
  const future = ref<HistoryEntry[]>([]);

  const canUndo = computed(() => past.value.length > 0);
  const canRedo = computed(() => future.value.length > 0);

  const lastEntry = computed(() => past.value[past.value.length - 1] ?? null);

  function getCommandLabelKey(type: TimelineCommand['type']): string {
    return COMMAND_LABEL_KEYS[type];
  }

  /**
   * Records a snapshot before a command is applied.
   * Should be called BEFORE mutating the timeline document.
   */
  function push(cmd: TimelineCommand, snapshot: TimelineDocument, labelKey?: string) {
    const entry: HistoryEntry = {
      id: ++entryIdCounter,
      labelKey: labelKey ?? getCommandLabelKey(cmd.type),
      commandType: cmd.type,
      snapshot,
      timestamp: Date.now(),
    };

    past.value.push(entry);

    if (past.value.length > MAX_HISTORY_SIZE) {
      past.value.splice(0, past.value.length - MAX_HISTORY_SIZE);
    }

    // Branching: clear redo stack on new action
    future.value = [];
  }

  /**
   * Moves the top past entry into the future stack and returns the snapshot
   * that should be restored as the current timeline document.
   */
  function undo(currentDoc: TimelineDocument): TimelineDocument | null {
    const entry = past.value[past.value.length - 1];
    if (!entry) return null;

    past.value.pop();

    future.value.unshift({
      ...entry,
      snapshot: currentDoc,
    });

    return entry.snapshot;
  }

  /**
   * Moves the first future entry into the past stack and returns the snapshot
   * to restore.
   */
  function redo(currentDoc: TimelineDocument): TimelineDocument | null {
    const entry = future.value[0];
    if (!entry) return null;

    future.value.shift();

    past.value.push({
      ...entry,
      snapshot: currentDoc,
    });

    return entry.snapshot;
  }

  /** Clears the entire history (e.g., when a new timeline is loaded) */
  function clear() {
    past.value = [];
    future.value = [];
  }

  return {
    past,
    future,
    canUndo,
    canRedo,
    lastEntry,
    getCommandLabelKey,
    multipleActionsLabelKey: MULTIPLE_ACTIONS_LABEL_KEY,
    push,
    undo,
    redo,
    clear,
  };
});
