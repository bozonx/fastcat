import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import type { TimelineDocument } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';

const MAX_HISTORY_SIZE = 100;

export interface HistoryEntry {
  id: number;
  label: string;
  commandType: TimelineCommand['type'];
  /** Snapshot of the timeline document BEFORE the command was applied */
  snapshot: TimelineDocument;
  timestamp: number;
}

let entryIdCounter = 0;

/** Human-readable labels for timeline command types */
const COMMAND_LABELS: Record<TimelineCommand['type'], string> = {
  add_clip_to_track: 'Add clip',
  add_virtual_clip_to_track: 'Add clip',
  remove_item: 'Remove item',
  delete_items: 'Delete items',
  move_item: 'Move clip',
  move_item_to_track: 'Move clip',
  trim_item: 'Trim clip',
  overlay_trim_item: 'Trim clip',
  overlay_place_item: 'Place clip',
  split_item: 'Split clip',
  rename_item: 'Rename clip',
  update_clip_properties: 'Update clip',
  update_clip_transition: 'Update transition',
  add_marker: 'Add marker',
  update_marker: 'Update marker',
  remove_marker: 'Remove marker',
  add_track: 'Add track',
  rename_track: 'Rename track',
  delete_track: 'Delete track',
  reorder_tracks: 'Reorder tracks',
  update_track_properties: 'Update track',
  extract_audio_to_track: 'Extract audio',
  return_audio_to_video: 'Return audio',
};

export const useHistoryStore = defineStore('history', () => {
  /** Past states: index 0 is the oldest, last is the most recent undo target */
  const past = ref<HistoryEntry[]>([]);
  /** Future states available for redo, index 0 is the next redo */
  const future = ref<HistoryEntry[]>([]);

  const canUndo = computed(() => past.value.length > 0);
  const canRedo = computed(() => future.value.length > 0);

  const lastEntry = computed(() => past.value[past.value.length - 1] ?? null);

  function getCommandLabel(type: TimelineCommand['type']): string {
    return COMMAND_LABELS[type];
  }

  /**
   * Records a snapshot before a command is applied.
   * Should be called BEFORE mutating the timeline document.
   */
  function push(cmd: TimelineCommand, snapshot: TimelineDocument, label?: string) {
    const entry: HistoryEntry = {
      id: ++entryIdCounter,
      label: label ?? getCommandLabel(cmd.type),
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
    push,
    undo,
    redo,
    clear,
  };
});
