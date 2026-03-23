import type { Ref } from 'vue';
import type { TimelineDocument } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';
import { calculateNextClipBoundary, calculatePrevClipBoundary } from '~/timeline/domain/navigation';
import {
  buildSplitClipCommands,
  buildSplitAllClipsCommands,
  buildSplitSelectedClipsCommands,
  computeCutUs,
} from '~/timeline/domain/editing';

export interface TimelineTrimmingDeps {
  timelineDoc: Ref<TimelineDocument | null>;
  currentTime: Ref<number>;
  duration: Ref<number>;
  selectedItemIds: Ref<string[]>;
  applyTimeline: (
    cmd: TimelineCommand,
    options?: {
      saveMode?: 'none' | 'debounced' | 'immediate';
      historyMode?: 'immediate' | 'debounced';
      historyDebounceMs?: number;
    },
  ) => void;
  batchApplyTimeline: (
    cmds: TimelineCommand[],
    options?: { saveMode?: 'none' | 'debounced' | 'immediate'; labelKey?: string },
  ) => void;
  requestTimelineSave: (options?: { immediate?: boolean }) => Promise<void>;
  getHotkeyTargetClip: () => { trackId: string; itemId: string } | null;
  getSelectedOrActiveTrackId: () => string | null;
  editService: {
    rippleDeleteRange: (
      input: { trackIds: string[]; startUs: number; endUs: number },
      options?: any,
    ) => void;
    rippleTrimRight: () => Promise<void>;
    rippleTrimLeft: () => Promise<void>;
    advancedRippleTrimRight: () => Promise<void>;
    advancedRippleTrimLeft: () => Promise<void>;
  };
}

export interface TimelineTrimmingApi {
  trimToPlayheadLeftNoRipple: (
    targetOverride?: { trackId: string; itemId: string } | null,
  ) => Promise<void>;
  trimToPlayheadRightNoRipple: (
    targetOverride?: { trackId: string; itemId: string } | null,
  ) => Promise<void>;
  rippleDeleteRange: (
    input: { trackIds: string[]; startUs: number; endUs: number },
    options?: any,
  ) => void;
  rippleTrimRight: () => Promise<void>;
  rippleTrimLeft: () => Promise<void>;
  advancedRippleTrimRight: () => Promise<void>;
  advancedRippleTrimLeft: () => Promise<void>;
  jumpToPrevClipBoundary: (options?: { currentTrackOnly?: boolean }) => void;
  jumpToNextClipBoundary: (options?: { currentTrackOnly?: boolean }) => void;
  splitClipAtPlayhead: (
    targetOverride?: { trackId: string; itemId: string } | null,
  ) => Promise<void>;
  splitAllClipsAtPlayhead: () => Promise<void>;
  splitClipsAtPlayhead: () => Promise<void>;
}

export function createTimelineTrimming(deps: TimelineTrimmingDeps): TimelineTrimmingApi {
  async function trimToPlayheadLeftNoRipple(
    targetOverride?: { trackId: string; itemId: string } | null,
  ) {
    const doc = deps.timelineDoc.value;
    if (!doc) return;

    const target = targetOverride ?? deps.getHotkeyTargetClip();
    if (!target) return;

    const track = doc.tracks.find((t) => t.id === target.trackId) ?? null;
    const item = track?.items.find((it) => it.kind === 'clip' && it.id === target.itemId) ?? null;
    if (!track || !item || item.kind !== 'clip') return;
    if (track.locked || item.locked) return;

    const cutUs = computeCutUs(doc, deps.currentTime.value);
    const startUs = item.timelineRange.startUs;
    const endUs = startUs + item.timelineRange.durationUs;
    if (!(cutUs > startUs && cutUs < endUs)) return;

    const cmds = buildSplitClipCommands(doc, deps.currentTime.value, target);
    for (const cmd of cmds) {
      deps.applyTimeline(cmd, {
        saveMode: 'none',
        historyMode: 'debounced',
        historyDebounceMs: 100,
      });
    }

    const updatedDoc = deps.timelineDoc.value;
    if (!updatedDoc) return;
    const updatedTrack = updatedDoc.tracks.find((t) => t.id === target.trackId) ?? null;
    if (!updatedTrack) return;

    // After split, 'item.id' is the LEFT part
    const left =
      updatedTrack.items.filter((it) => it.kind === 'clip').find((it) => it.id === target.itemId) ??
      null;
    if (!left || left.kind !== 'clip') return;

    deps.applyTimeline(
      { type: 'delete_items', trackId: target.trackId, itemIds: [left.id] },
      { saveMode: 'none', historyMode: 'debounced', historyDebounceMs: 100 },
    );

    await deps.requestTimelineSave({ immediate: true });
  }

  async function trimToPlayheadRightNoRipple(
    targetOverride?: { trackId: string; itemId: string } | null,
  ) {
    const doc = deps.timelineDoc.value;
    if (!doc) return;

    const target = targetOverride ?? deps.getHotkeyTargetClip();
    if (!target) return;

    const track = doc.tracks.find((t) => t.id === target.trackId) ?? null;
    const item = track?.items.find((it) => it.kind === 'clip' && it.id === target.itemId) ?? null;
    if (!track || !item || item.kind !== 'clip') return;
    if (track.locked || item.locked) return;

    const cutUs = computeCutUs(doc, deps.currentTime.value);
    const startUs = item.timelineRange.startUs;
    const endUs = startUs + item.timelineRange.durationUs;
    if (!(cutUs > startUs && cutUs < endUs)) return;

    const cmds = buildSplitClipCommands(doc, deps.currentTime.value, target);
    for (const cmd of cmds) {
      deps.applyTimeline(cmd, {
        saveMode: 'none',
        historyMode: 'debounced',
        historyDebounceMs: 100,
      });
    }

    const updatedDoc = deps.timelineDoc.value;
    if (!updatedDoc) return;
    const updatedTrack = updatedDoc.tracks.find((t) => t.id === target.trackId) ?? null;
    if (!updatedTrack) return;

    // After split, the new item with startUs === cutUs is the RIGHT part
    const right =
      updatedTrack.items
        .filter((it) => it.kind === 'clip')
        .find((it) => it.timelineRange.startUs === cutUs) ?? null;
    if (!right || right.kind !== 'clip') return;

    deps.applyTimeline(
      { type: 'delete_items', trackId: target.trackId, itemIds: [right.id] },
      { saveMode: 'none', historyMode: 'debounced', historyDebounceMs: 100 },
    );

    await deps.requestTimelineSave({ immediate: true });
  }

  function rippleDeleteRange(
    input: { trackIds: string[]; startUs: number; endUs: number },
    options?: any,
  ) {
    deps.editService.rippleDeleteRange(input, options);
  }

  async function rippleTrimRight() {
    await deps.editService.rippleTrimRight();
  }

  async function rippleTrimLeft() {
    await deps.editService.rippleTrimLeft();
  }

  async function advancedRippleTrimRight() {
    await deps.editService.advancedRippleTrimRight();
  }

  async function advancedRippleTrimLeft() {
    await deps.editService.advancedRippleTrimLeft();
  }

  function jumpToPrevClipBoundary(options?: { currentTrackOnly?: boolean }) {
    const doc = deps.timelineDoc.value;
    if (!doc) return;
    const prevUs = calculatePrevClipBoundary(doc, deps.currentTime.value, {
      currentTrackOnly: options?.currentTrackOnly,
      currentTrackId: deps.getSelectedOrActiveTrackId(),
    });
    if (prevUs === null) {
      deps.currentTime.value = 0;
    } else {
      deps.currentTime.value = prevUs;
    }
  }

  function jumpToNextClipBoundary(options?: { currentTrackOnly?: boolean }) {
    const doc = deps.timelineDoc.value;
    if (!doc) return;
    const nextUs = calculateNextClipBoundary(doc, deps.currentTime.value, deps.duration.value, {
      currentTrackOnly: options?.currentTrackOnly,
      currentTrackId: deps.getSelectedOrActiveTrackId(),
    });
    deps.currentTime.value = nextUs;
  }

  async function splitClipAtPlayhead(targetOverride?: { trackId: string; itemId: string } | null) {
    const doc = deps.timelineDoc.value;
    if (!doc) return;

    const target = targetOverride ?? deps.getHotkeyTargetClip();
    if (!target) return;

    const track = doc.tracks.find((t) => t.id === target.trackId);
    if (!track || track.locked) return;
    const item = track.items.find((it) => it.id === target.itemId);
    if (!item || (item.kind === 'clip' && item.locked)) return;

    const cmds = buildSplitClipCommands(doc, deps.currentTime.value, target);
    for (const cmd of cmds) {
      deps.applyTimeline(cmd, { saveMode: 'none' });
    }
    await deps.requestTimelineSave({ immediate: true });
  }

  async function splitAllClipsAtPlayhead() {
    const doc = deps.timelineDoc.value;
    if (!doc) return;

    const cmds = buildSplitAllClipsCommands(doc, deps.currentTime.value);
    if (cmds.length === 0) return;

    deps.batchApplyTimeline(cmds, {
      labelKey: 'videoEditor.fileManager.history.entries.splitAllClips',
      saveMode: 'immediate',
    });
  }

  async function splitClipsAtPlayhead() {
    const doc = deps.timelineDoc.value;
    if (!doc) return;

    const selectedItemIds = deps.selectedItemIds.value;
    const itemIdsToSplit = selectedItemIds.filter((itemId) => {
      let isLocked = false;
      for (const track of doc.tracks) {
        const item = track.items.find((it) => it.id === itemId);
        if (item) {
          if (track.locked || (item.kind === 'clip' && item.locked)) {
            isLocked = true;
          }
          break;
        }
      }
      return !isLocked;
    });

    const cmds = buildSplitSelectedClipsCommands(
      doc,
      deps.currentTime.value,
      itemIdsToSplit,
    );
    if (cmds.length === 0) return;

    deps.batchApplyTimeline(cmds, {
      labelKey: 'videoEditor.fileManager.history.entries.splitSelectedClips',
      saveMode: 'immediate',
    });

    await deps.requestTimelineSave({ immediate: true });
  }

  return {
    trimToPlayheadLeftNoRipple,
    trimToPlayheadRightNoRipple,
    rippleDeleteRange,
    rippleTrimRight,
    rippleTrimLeft,
    advancedRippleTrimRight,
    advancedRippleTrimLeft,
    jumpToPrevClipBoundary,
    jumpToNextClipBoundary,
    splitClipAtPlayhead,
    splitAllClipsAtPlayhead,
    splitClipsAtPlayhead,
  };
}
