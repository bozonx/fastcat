import type { Ref } from 'vue';
import type { TimelineDocument } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';
import type { TimelineApplyOptions } from './commands';
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
  timelineZoom: Ref<number>;
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
  ) => string[];
  requestTimelineSave: (options?: { immediate?: boolean }) => Promise<void>;
  getHotkeyTargetClip: () => { trackId: string; itemId: string } | null;
  getSelectedOrActiveTrackId: () => string | null;
  onPlayheadJump?: () => void;
  editService: {
    rippleDeleteRange: (
      input: { trackIds: string[]; startUs: number; endUs: number },
      options?: TimelineApplyOptions,
    ) => number | null;
    rippleTrimRight: () => Promise<number | null>;
    rippleTrimLeft: () => Promise<number | null>;
    advancedRippleTrimRight: () => Promise<number | null>;
    advancedRippleTrimLeft: () => Promise<number | null>;
  };
}

export interface TimelineTrimmingModule {
  trimToPlayheadLeftNoRipple: (
    targetOverride?: { trackId: string; itemId: string } | null,
  ) => Promise<void>;
  trimToPlayheadRightNoRipple: (
    targetOverride?: { trackId: string; itemId: string } | null,
  ) => Promise<void>;
  trimToTimeLeftNoRipple: (
    target: { trackId: string; itemId: string } | null,
    atUs: number,
  ) => Promise<void>;
  trimToTimeRightNoRipple: (
    target: { trackId: string; itemId: string } | null,
    atUs: number,
  ) => Promise<void>;
  rippleDeleteRange: (
    input: { trackIds: string[]; startUs: number; endUs: number },
    options?: TimelineApplyOptions,
  ) => void;
  rippleTrimRight: () => Promise<void>;
  rippleTrimLeft: () => Promise<void>;
  rippleDeleteSelectedClipRangeAllTracks: () => void;
  advancedRippleTrimRight: () => Promise<void>;
  advancedRippleTrimLeft: () => Promise<void>;
  jumpToPrevClipBoundary: (options?: { currentTrackOnly?: boolean }) => void;
  jumpToNextClipBoundary: (options?: { currentTrackOnly?: boolean }) => void;
  splitClipAtPlayhead: (
    targetOverride?: { trackId: string; itemId: string } | null,
  ) => Promise<void>;
  splitClipAtTime: (target: { trackId: string; itemId: string }, atUs: number) => Promise<void>;
  splitAllClipsAtPlayhead: () => Promise<void>;
  splitClipsAtPlayhead: () => Promise<void>;
}

export function createTimelineTrimmingModule(deps: TimelineTrimmingDeps): TimelineTrimmingModule {
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

  async function trimToTimeLeftNoRipple(
    target: { trackId: string; itemId: string } | null,
    atUs: number,
  ) {
    const doc = deps.timelineDoc.value;
    if (!doc || !target) return;

    const track = doc.tracks.find((t) => t.id === target.trackId) ?? null;
    const item = track?.items.find((it) => it.kind === 'clip' && it.id === target.itemId) ?? null;
    if (!track || !item || item.kind !== 'clip') return;
    if (track.locked || item.locked) return;

    const cutUs = computeCutUs(doc, atUs);
    const startUs = item.timelineRange.startUs;
    const endUs = startUs + item.timelineRange.durationUs;
    if (!(cutUs > startUs && cutUs < endUs)) return;

    const cmds = buildSplitClipCommands(doc, atUs, target);
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

  async function trimToTimeRightNoRipple(
    target: { trackId: string; itemId: string } | null,
    atUs: number,
  ) {
    const doc = deps.timelineDoc.value;
    if (!doc || !target) return;

    const track = doc.tracks.find((t) => t.id === target.trackId) ?? null;
    const item = track?.items.find((it) => it.kind === 'clip' && it.id === target.itemId) ?? null;
    if (!track || !item || item.kind !== 'clip') return;
    if (track.locked || item.locked) return;

    const cutUs = computeCutUs(doc, atUs);
    const startUs = item.timelineRange.startUs;
    const endUs = startUs + item.timelineRange.durationUs;
    if (!(cutUs > startUs && cutUs < endUs)) return;

    const cmds = buildSplitClipCommands(doc, atUs, target);
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
    options?: TimelineApplyOptions,
  ) {
    movePlayheadToCollapse(deps.editService.rippleDeleteRange(input, options));
  }

  async function rippleTrimRight() {
    movePlayheadToCollapse(await deps.editService.rippleTrimRight());
  }

  async function rippleTrimLeft() {
    movePlayheadToCollapse(await deps.editService.rippleTrimLeft());
  }

  function rippleDeleteSelectedClipRangeAllTracks() {
    const doc = deps.timelineDoc.value;
    if (!doc) return;

    const selectedItemIdSet = new Set(deps.selectedItemIds.value);
    if (selectedItemIdSet.size === 0) return;

    const target =
      doc.tracks
        .flatMap((track) =>
          track.items.map((item) => ({
            track,
            item,
          })),
        )
        .find(
          ({ item }) =>
            selectedItemIdSet.has(item.id) && (item.kind === 'clip' || item.kind === 'gap'),
        ) ?? null;

    if (!target) return;
    if (target.track.locked) return;
    if (target.item.kind === 'clip' && target.item.locked) return;

    const startUs = target.item.timelineRange.startUs;
    const endUs = startUs + target.item.timelineRange.durationUs;
    if (!(endUs > startUs)) return;

    rippleDeleteRange(
      {
        trackIds: doc.tracks.map((item) => item.id),
        startUs,
        endUs,
      },
      {
        historyMode: 'debounced',
        historyDebounceMs: 100,
        labelKey: 'videoEditor.fileManager.history.entries.deleteItems',
      },
    );
  }

  function movePlayheadToCollapse(collapseUs: number | null) {
    if (collapseUs === null) return;
    deps.currentTime.value = collapseUs;
    deps.onPlayheadJump?.();
  }

  async function advancedRippleTrimRight() {
    movePlayheadToCollapse(await deps.editService.advancedRippleTrimRight());
  }

  async function advancedRippleTrimLeft() {
    movePlayheadToCollapse(await deps.editService.advancedRippleTrimLeft());
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
    deps.onPlayheadJump?.();
  }

  function jumpToNextClipBoundary(options?: { currentTrackOnly?: boolean }) {
    const doc = deps.timelineDoc.value;
    if (!doc) return;
    const nextUs = calculateNextClipBoundary(doc, deps.currentTime.value, deps.duration.value, {
      currentTrackOnly: options?.currentTrackOnly,
      currentTrackId: deps.getSelectedOrActiveTrackId(),
    });
    deps.currentTime.value = nextUs;
    deps.onPlayheadJump?.();
  }

  async function splitClipAtPlayhead(targetOverride?: { trackId: string; itemId: string } | null) {
    if (!targetOverride && deps.selectedItemIds.value.length > 0) {
      await splitClipsAtPlayhead();
    } else {
      await splitClipAtTime(targetOverride ?? deps.getHotkeyTargetClip(), deps.currentTime.value);
    }
  }

  async function splitClipAtTime(target: { trackId: string; itemId: string } | null, atUs: number) {
    const doc = deps.timelineDoc.value;
    if (!doc) return;

    if (!target) return;

    const track = doc.tracks.find((t) => t.id === target.trackId);
    if (!track || track.locked) return;
    const item = track.items.find((it) => it.id === target.itemId);
    if (!item || (item.kind === 'clip' && item.locked)) return;

    const cmds = buildSplitClipCommands(doc, atUs, target);
    if (cmds.length > 0) {
      const createdIds = deps.batchApplyTimeline(cmds, {
        saveMode: 'none',
        labelKey: 'videoEditor.fileManager.history.entries.splitClip',
      });
      if (createdIds && createdIds.length > 0) {
        const currentSelection = deps.selectedItemIds.value;
        const remainingSelection = currentSelection.filter((id) => id !== target.itemId);
        const allIds = Array.from(new Set([...remainingSelection, ...createdIds]));
        deps.selectedItemIds.value = allIds;
      }
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

    const cmds = buildSplitSelectedClipsCommands(doc, deps.currentTime.value, itemIdsToSplit);
    if (cmds.length === 0) return;

    const createdIds = deps.batchApplyTimeline(cmds, {
      labelKey: 'videoEditor.fileManager.history.entries.splitSelectedClips',
      saveMode: 'immediate',
    });

    if (createdIds && createdIds.length > 0) {
      const splitItemIds = cmds
        .map((c) => (c as { itemId?: string }).itemId)
        .filter((id): id is string => typeof id === 'string');
      const splitItemIdsSet = new Set(splitItemIds);
      const remainingSelection = selectedItemIds.filter((id) => !splitItemIdsSet.has(id));
      const allIds = Array.from(new Set([...remainingSelection, ...createdIds]));
      deps.selectedItemIds.value = allIds;
    }

    await deps.requestTimelineSave({ immediate: true });
  }

  return {
    trimToPlayheadLeftNoRipple,
    trimToPlayheadRightNoRipple,
    trimToTimeLeftNoRipple,
    trimToTimeRightNoRipple,
    rippleDeleteRange,
    rippleTrimRight,
    rippleTrimLeft,
    rippleDeleteSelectedClipRangeAllTracks,
    advancedRippleTrimRight,
    advancedRippleTrimLeft,
    jumpToPrevClipBoundary,
    jumpToNextClipBoundary,
    splitClipAtPlayhead,
    splitClipAtTime,
    splitAllClipsAtPlayhead,
    splitClipsAtPlayhead,
  };
}
