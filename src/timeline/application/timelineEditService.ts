import type { TimelineDocument, TimelineClipItem, TimelineTrack } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';
import type { TimelineApplyOptions } from '~/timeline/apply-options';

import { buildRippleMarkerCommands } from '~/timeline/domain/markers';
import { computeCutUs } from '~/timeline/domain/editing';

interface HotkeyTarget {
  trackId: string;
  itemId: string;
}

export interface TimelineEditServiceDeps {
  getDoc: () => TimelineDocument | null;
  getHotkeyTargetClip: () => HotkeyTarget | null;
  getSelectedItemIds: () => string[];
  getCurrentTime: () => number;
  applyTimeline: (cmd: TimelineCommand, options?: TimelineApplyOptions) => void;
  batchApplyTimeline: (cmds: TimelineCommand[], options?: TimelineApplyOptions) => void;
  pushTimelineHistory: (preState: TimelineDocument, commandType: string, labelKey: string) => void;
  requestTimelineSave: (options?: { immediate?: boolean }) => Promise<void>;
}

interface RippleDeleteRangeParams {
  trackIds: string[];
  startUs: number;
  endUs: number;
}

export function createTimelineEditService(deps: TimelineEditServiceDeps) {
  function getTrackById(doc: TimelineDocument, trackId: string): TimelineTrack | null {
    return doc.tracks.find((t) => t.id === trackId) ?? null;
  }

  function rippleDeleteRange(
    input: RippleDeleteRangeParams,
    options?: TimelineApplyOptions,
  ): number | null {
    const doc = deps.getDoc();
    if (!doc) return null;
    const preState = doc;

    const startUs = computeCutUs(doc, input.startUs);
    const endUs = computeCutUs(doc, input.endUs);
    if (!(endUs > startUs)) return null;

    const deltaUs = endUs - startUs;
    const trackIdSet = new Set(input.trackIds);
    const batchOptions: TimelineApplyOptions = options ?? {
      saveMode: 'none',
    };
    const internalBatchOptions: TimelineApplyOptions = {
      ...batchOptions,
      skipHistory: true,
    };

    const buildSplitCmds = (fromDoc: TimelineDocument, atUs: number): TimelineCommand[] => {
      const cmds: TimelineCommand[] = [];
      for (const track of fromDoc.tracks) {
        if (!trackIdSet.has(track.id)) continue;
        if (track.locked) continue;
        for (const it of track.items) {
          if (it.kind !== 'clip') continue;
          if (it.locked) continue;
          const itStart = it.timelineRange.startUs;
          const itEnd = itStart + it.timelineRange.durationUs;
          if (!(atUs > itStart && atUs < itEnd)) continue;
          cmds.push({ type: 'split_item', trackId: track.id, itemId: it.id, atUs });
        }
      }
      return cmds;
    };

    // Phase 1: split at endUs then startUs (sequential — each split changes doc state)
    const splitCmdsEnd = buildSplitCmds(doc, endUs);
    if (splitCmdsEnd.length > 0) {
      deps.batchApplyTimeline(splitCmdsEnd, internalBatchOptions);
    }

    const afterSplitEnd = deps.getDoc();
    if (!afterSplitEnd) return null;

    const splitCmdsStart = buildSplitCmds(afterSplitEnd, startUs);
    if (splitCmdsStart.length > 0) {
      deps.batchApplyTimeline(splitCmdsStart, internalBatchOptions);
    }

    // Phase 2: delete clips that lie entirely (or all but an epsilon) within the cut range.
    const updated = deps.getDoc();
    if (!updated) return null;

    const EPSILON = 10;
    const deleteCmds: TimelineCommand[] = [];
    for (const track of updated.tracks) {
      if (!trackIdSet.has(track.id)) continue;

      if (track.locked) continue;

      const toDelete: string[] = [];
      for (const it of track.items) {
        if (it.kind !== 'clip') continue;
        if (it.locked) continue;
        const itStart = it.timelineRange.startUs;
        const itEnd = itStart + it.timelineRange.durationUs;
        // After the splits at startUs and endUs every survivor either lies entirely
        // inside or entirely outside [startUs, endUs]. Use the actual edges (with
        // epsilon) instead of the midpoint — the midpoint heuristic fails when the
        // split was quantized to a frame boundary.
        if (itStart >= startUs - EPSILON && itEnd <= endUs + EPSILON) {
          toDelete.push(it.id);
        }
      }

      if (toDelete.length > 0) {
        deleteCmds.push({ type: 'delete_items', trackId: track.id, itemIds: toDelete });
      }
    }
    if (deleteCmds.length > 0) {
      deps.batchApplyTimeline(deleteCmds, internalBatchOptions);
    }

    // Phase 3: shift clips after the deleted range, preserving frame alignment.
    const afterDelete = deps.getDoc();
    if (!afterDelete) return null;

    const moveCmds: TimelineCommand[] = [];
    for (const track of afterDelete.tracks) {
      if (!trackIdSet.has(track.id)) continue;
      if (track.locked) continue;

      const clips = track.items
        .filter((it): it is TimelineClipItem => it.kind === 'clip')
        .slice()
        .sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);

      for (const clip of clips) {
        if (clip.locked) continue;
        const clipStart = clip.timelineRange.startUs;
        if (clipStart >= endUs - EPSILON) {
          // Clamp to startUs so a clip that straddles the right edge by a few µs
          // (sub-frame split residue) does not overlap the pre-cut region.
          const nextStart = Math.max(startUs, clipStart - deltaUs);
          moveCmds.push({
            type: 'move_item',
            trackId: track.id,
            itemId: clip.id,
            startUs: nextStart,
            // Quantize so the ripple keeps clips on frame boundaries.
            quantizeToFrames: true,
          });
        }
      }
    }
    if (moveCmds.length > 0) {
      deps.batchApplyTimeline(moveCmds, internalBatchOptions);
    }

    // Phase 4: update markers in the same way the clips were moved.
    const markerDoc = deps.getDoc();
    if (markerDoc) {
      const markerCmds = buildRippleMarkerCommands(markerDoc, startUs, endUs);
      if (markerCmds.length > 0) {
        deps.batchApplyTimeline(markerCmds, internalBatchOptions);
      }
    }

    const finalDoc = deps.getDoc();
    if (finalDoc && finalDoc !== preState && !options?.skipHistory) {
      deps.pushTimelineHistory(
        preState,
        'delete_items',
        options?.labelKey ?? 'videoEditor.fileManager.history.entries.deleteItems',
      );
    }

    return startUs;
  }

  async function rippleTrimRight(): Promise<number | null> {
    const doc = deps.getDoc();
    if (!doc) return null;

    const target = deps.getHotkeyTargetClip();
    if (!target) return null;

    const track = getTrackById(doc, target.trackId);
    const item = track?.items.find((it) => it.kind === 'clip' && it.id === target.itemId) ?? null;
    if (!track || !item || item.kind !== 'clip') return null;
    if (track.locked || item.locked) return null;

    const cutUs = computeCutUs(doc, deps.getCurrentTime());
    const startUs = item.timelineRange.startUs;
    const endUs = startUs + item.timelineRange.durationUs;

    if (!(cutUs > startUs && cutUs < endUs)) return null;

    const deltaUs = endUs - cutUs;
    if (deltaUs <= 0) return null;

    const cmds: TimelineCommand[] = [
      {
        type: 'trim_item',
        trackId: target.trackId,
        itemId: target.itemId,
        edge: 'end',
        deltaUs: -deltaUs,
      },
    ];

    const moves: Array<{
      fromTrackId: string;
      toTrackId: string;
      itemId: string;
      startUs: number;
    }> = [];

    for (const it of track.items) {
      if (it.kind !== 'clip') continue;
      if (it.id === target.itemId) continue;
      if (it.timelineRange.startUs < endUs - 10) continue;
      moves.push({
        fromTrackId: target.trackId,
        toTrackId: target.trackId,
        itemId: it.id,
        startUs: Math.max(0, it.timelineRange.startUs - deltaUs),
      });
    }

    if (moves.length > 0) {
      cmds.push({
        type: 'move_items',
        moves,
        quantizeToFrames: true,
        ignoreLinks: true,
      });
    }

    // rippleTrimRight removes [cutUs, endUs] of timeline space.
    cmds.push(...buildRippleMarkerCommands(doc, cutUs, cutUs + deltaUs));

    deps.batchApplyTimeline(cmds, {
      saveMode: 'none',
      labelKey: 'videoEditor.fileManager.history.entries.trimClip',
    });

    await deps.requestTimelineSave({ immediate: true });
    return cutUs;
  }

  async function rippleTrimLeft(): Promise<number | null> {
    const doc = deps.getDoc();
    if (!doc) return null;

    const target = deps.getHotkeyTargetClip();
    if (!target) return null;

    const track = getTrackById(doc, target.trackId);
    const item = track?.items.find((it) => it.kind === 'clip' && it.id === target.itemId) ?? null;
    if (!track || !item || item.kind !== 'clip') return null;
    if (track.locked || item.locked) return null;

    const cutUs = computeCutUs(doc, deps.getCurrentTime());
    const startUs = item.timelineRange.startUs;
    const endUs = startUs + item.timelineRange.durationUs;

    if (!(cutUs > startUs && cutUs < endUs)) return null;

    const deltaUs = cutUs - startUs;
    if (deltaUs <= 0) return null;

    const cmds: TimelineCommand[] = [
      {
        type: 'trim_item',
        trackId: target.trackId,
        itemId: target.itemId,
        edge: 'start',
        deltaUs,
      },
      // A start-edge trim parks the clip at the cut (its left edge moves to
      // cutUs). Slide the surviving portion back to the original left edge so it
      // fills the removed span instead of leaving a gap — the left counterpart
      // of rippleTrimRight, where trimming the end keeps the start fixed. Links
      // are honored so locked linked audio (already retimed by the trim above)
      // follows the clip.
      {
        type: 'move_item',
        trackId: target.trackId,
        itemId: target.itemId,
        startUs,
        quantizeToFrames: true,
      },
    ];

    const moves: Array<{
      fromTrackId: string;
      toTrackId: string;
      itemId: string;
      startUs: number;
    }> = [];

    for (const it of track.items) {
      if (it.kind !== 'clip') continue;
      if (it.id === target.itemId) continue;
      if (it.timelineRange.startUs < cutUs - 10) continue;
      moves.push({
        fromTrackId: target.trackId,
        toTrackId: target.trackId,
        itemId: it.id,
        startUs: Math.max(0, it.timelineRange.startUs - deltaUs),
      });
    }

    if (moves.length > 0) {
      cmds.push({
        type: 'move_items',
        moves,
        quantizeToFrames: true,
        ignoreLinks: true,
      });
    }

    // rippleTrimLeft removes [startUs, cutUs] of timeline space.
    cmds.push(...buildRippleMarkerCommands(doc, startUs, startUs + deltaUs));

    deps.batchApplyTimeline(cmds, {
      saveMode: 'none',
      labelKey: 'videoEditor.fileManager.history.entries.trimClip',
    });

    await deps.requestTimelineSave({ immediate: true });
    return startUs;
  }

  async function advancedRippleTrimRight(): Promise<number | null> {
    const doc = deps.getDoc();
    if (!doc) return null;

    if (deps.getSelectedItemIds().length !== 1) return null;
    const target = deps.getHotkeyTargetClip();
    if (!target) return null;

    const track = getTrackById(doc, target.trackId);
    const item = track?.items.find((it) => it.kind === 'clip' && it.id === target.itemId) ?? null;
    if (!track || !item || item.kind !== 'clip') return null;
    if (track.locked || item.locked) return null;

    const cutUs = computeCutUs(doc, deps.getCurrentTime());
    const startUs = item.timelineRange.startUs;
    const endUs = startUs + item.timelineRange.durationUs;

    if (!(cutUs > startUs && cutUs < endUs)) return null;

    const deltaUs = endUs - cutUs;
    if (deltaUs <= 0) return null;

    const collapseUs = rippleDeleteRange(
      {
        trackIds: doc.tracks.map((item) => item.id),
        startUs: cutUs,
        endUs,
      },
      {
        saveMode: 'none',
        labelKey: 'videoEditor.fileManager.history.entries.trimClip',
      },
    );
    if (collapseUs === null) return null;
    await deps.requestTimelineSave({ immediate: true });
    return collapseUs;
  }

  async function advancedRippleTrimLeft(): Promise<number | null> {
    const doc = deps.getDoc();
    if (!doc) return null;

    if (deps.getSelectedItemIds().length !== 1) return null;
    const target = deps.getHotkeyTargetClip();
    if (!target) return null;

    const track = getTrackById(doc, target.trackId);
    const item = track?.items.find((it) => it.kind === 'clip' && it.id === target.itemId) ?? null;
    if (!track || !item || item.kind !== 'clip') return null;
    if (track.locked || item.locked) return null;

    const cutUs = computeCutUs(doc, deps.getCurrentTime());
    const startUs = item.timelineRange.startUs;
    const endUs = startUs + item.timelineRange.durationUs;

    if (!(cutUs > startUs && cutUs < endUs)) return null;

    const deltaUs = cutUs - startUs;
    if (deltaUs <= 0) return null;

    const collapseUs = rippleDeleteRange(
      {
        trackIds: doc.tracks.map((item) => item.id),
        startUs,
        endUs: cutUs,
      },
      {
        saveMode: 'none',
        labelKey: 'videoEditor.fileManager.history.entries.trimClip',
      },
    );
    if (collapseUs === null) return null;
    await deps.requestTimelineSave({ immediate: true });
    return collapseUs;
  }

  return {
    rippleTrimRight,
    rippleTrimLeft,
    advancedRippleTrimRight,
    advancedRippleTrimLeft,
    rippleDeleteRange,
  };
}
