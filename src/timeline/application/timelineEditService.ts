import type { TimelineDocument } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';
import type { TimelineClipItem, TimelineTrack } from '~/timeline/types';

interface HotkeyTarget {
  trackId: string;
  itemId: string;
}

export interface TimelineEditServiceDeps {
  getDoc: () => TimelineDocument | null;
  getHotkeyTargetClip: () => HotkeyTarget | null;
  getSelectedItemIds: () => string[];
  getCurrentTime: () => number;
  applyTimeline: (
    cmd: TimelineCommand,
    options?: {
      saveMode?: 'debounced' | 'immediate' | 'none';
      skipHistory?: boolean;
      historyMode?: 'immediate' | 'debounced';
      historyDebounceMs?: number;
      label?: string;
    },
  ) => void;
  requestTimelineSave: (options?: { immediate?: boolean }) => Promise<void>;
  computeCutUs: (doc: TimelineDocument, atUs: number) => number;
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

  function rippleDeleteRange(input: RippleDeleteRangeParams) {
    const doc = deps.getDoc();
    if (!doc) return;

    const startUs = deps.computeCutUs(doc, input.startUs);
    const endUs = deps.computeCutUs(doc, input.endUs);
    if (!(endUs > startUs)) return;

    const deltaUs = endUs - startUs;
    const trackIdSet = new Set(input.trackIds);

    const splitTargets: Array<{ trackId: string; itemId: string }> = [];
    for (const track of doc.tracks) {
      if (!trackIdSet.has(track.id)) continue;
      for (const it of track.items) {
        if (it.kind !== 'clip') continue;
        splitTargets.push({ trackId: track.id, itemId: it.id });
      }
    }

    const splitAt = (atUs: number) => {
      for (const t of splitTargets) {
        deps.applyTimeline(
          { type: 'split_item', trackId: t.trackId, itemId: t.itemId, atUs },
          { saveMode: 'none', historyMode: 'debounced', historyDebounceMs: 100 },
        );
      }
    };

    splitAt(endUs);
    splitAt(startUs);

    const updated = deps.getDoc();
    if (!updated) return;

    for (const track of updated.tracks) {
      if (!trackIdSet.has(track.id)) continue;

      const toDelete: string[] = [];
      for (const it of track.items) {
        if (it.kind !== 'clip') continue;
        const itStart = it.timelineRange.startUs;
        const center = itStart + it.timelineRange.durationUs / 2;

        if (center >= startUs && center <= endUs) {
          toDelete.push(it.id);
        }
      }

      if (toDelete.length > 0) {
        deps.applyTimeline(
          { type: 'delete_items', trackId: track.id, itemIds: toDelete },
          { saveMode: 'none', historyMode: 'debounced', historyDebounceMs: 100 },
        );
      }
    }

    const afterDelete = deps.getDoc();
    if (!afterDelete) return;

    const EPSILON = 10;
    for (const track of afterDelete.tracks) {
      if (!trackIdSet.has(track.id)) continue;

      const clips = track.items
        .filter((it): it is TimelineClipItem => it.kind === 'clip')
        .slice()
        .sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);

      for (const clip of clips) {
        const clipStart = clip.timelineRange.startUs;
        if (clipStart >= endUs - EPSILON) {
          deps.applyTimeline(
            {
              type: 'move_item',
              trackId: track.id,
              itemId: clip.id,
              startUs: Math.max(0, clipStart - deltaUs),
            },
            { saveMode: 'none', historyMode: 'debounced', historyDebounceMs: 100 },
          );
        }
      }
    }
  }

  async function rippleTrimRight() {
    const doc = deps.getDoc();
    if (!doc) return;

    const target = deps.getHotkeyTargetClip();
    if (!target) return;

    const track = getTrackById(doc, target.trackId);
    const item = track?.items.find((it) => it.kind === 'clip' && it.id === target.itemId) ?? null;
    if (!track || !item || item.kind !== 'clip') return;

    const cutUs = deps.computeCutUs(doc, deps.getCurrentTime());
    const startUs = item.timelineRange.startUs;
    const endUs = startUs + item.timelineRange.durationUs;

    if (!(cutUs > startUs && cutUs < endUs)) return;

    const deltaUs = endUs - cutUs;
    if (deltaUs <= 0) return;

    deps.applyTimeline(
      {
        type: 'trim_item',
        trackId: target.trackId,
        itemId: target.itemId,
        edge: 'end',
        deltaUs: -deltaUs,
      },
      { saveMode: 'none', historyMode: 'debounced', historyDebounceMs: 100 },
    );

    const updatedDoc = deps.getDoc();
    if (!updatedDoc) return;
    const updatedTrack = getTrackById(updatedDoc, target.trackId);
    if (!updatedTrack) return;

    const subsequentClips = updatedTrack.items
      .filter((it): it is TimelineClipItem => it.kind === 'clip')
      .filter((it) => it.timelineRange.startUs >= endUs - 10);

    for (const clip of subsequentClips) {
      deps.applyTimeline(
        {
          type: 'move_item',
          trackId: target.trackId,
          itemId: clip.id,
          startUs: Math.max(0, clip.timelineRange.startUs - deltaUs),
        },
        { saveMode: 'none', historyMode: 'debounced', historyDebounceMs: 100 },
      );
    }

    await deps.requestTimelineSave({ immediate: true });
  }

  async function rippleTrimLeft() {
    const doc = deps.getDoc();
    if (!doc) return;

    const target = deps.getHotkeyTargetClip();
    if (!target) return;

    const track = getTrackById(doc, target.trackId);
    const item = track?.items.find((it) => it.kind === 'clip' && it.id === target.itemId) ?? null;
    if (!track || !item || item.kind !== 'clip') return;

    const cutUs = deps.computeCutUs(doc, deps.getCurrentTime());
    const startUs = item.timelineRange.startUs;
    const endUs = startUs + item.timelineRange.durationUs;

    if (!(cutUs > startUs && cutUs < endUs)) return;

    const deltaUs = cutUs - startUs;
    if (deltaUs <= 0) return;

    deps.applyTimeline(
      {
        type: 'trim_item',
        trackId: target.trackId,
        itemId: target.itemId,
        edge: 'start',
        deltaUs,
      },
      { saveMode: 'none', historyMode: 'debounced', historyDebounceMs: 100 },
    );

    const updatedDoc = deps.getDoc();
    if (!updatedDoc) return;
    const updatedTrack = getTrackById(updatedDoc, target.trackId);
    if (!updatedTrack) return;

    const clipsToShift = updatedTrack.items
      .filter((it): it is TimelineClipItem => it.kind === 'clip')
      .filter((it) => it.timelineRange.startUs >= cutUs - 10);

    for (const clip of clipsToShift) {
      deps.applyTimeline(
        {
          type: 'move_item',
          trackId: target.trackId,
          itemId: clip.id,
          startUs: Math.max(0, clip.timelineRange.startUs - deltaUs),
        },
        { saveMode: 'none', historyMode: 'debounced', historyDebounceMs: 100 },
      );
    }

    await deps.requestTimelineSave({ immediate: true });
  }

  async function advancedRippleTrimRight() {
    const doc = deps.getDoc();
    if (!doc) return;

    if (deps.getSelectedItemIds().length !== 1) return;
    const target = deps.getHotkeyTargetClip();
    if (!target) return;

    const track = getTrackById(doc, target.trackId);
    const item = track?.items.find((it) => it.kind === 'clip' && it.id === target.itemId) ?? null;
    if (!track || !item || item.kind !== 'clip') return;

    const cutUs = deps.computeCutUs(doc, deps.getCurrentTime());
    const startUs = item.timelineRange.startUs;
    const endUs = startUs + item.timelineRange.durationUs;

    if (!(cutUs > startUs && cutUs < endUs)) return;

    const deltaUs = endUs - cutUs;
    if (deltaUs <= 0) return;

    const splitAt = (atUs: number) => {
      for (const t of doc.tracks) {
        for (const it of t.items) {
          if (it.kind !== 'clip') continue;
          const itStart = it.timelineRange.startUs;
          const itEnd = itStart + it.timelineRange.durationUs;
          if (atUs > itStart && atUs < itEnd) {
            deps.applyTimeline(
              { type: 'split_item', trackId: t.id, itemId: it.id, atUs, ignoreLocks: true },
              { saveMode: 'none', historyMode: 'debounced', historyDebounceMs: 100 },
            );
          }
        }
      }
    };

    splitAt(endUs);
    splitAt(cutUs);

    const updated = deps.getDoc();
    if (!updated) return;

    for (const t of updated.tracks) {
      const toDelete: string[] = [];
      for (const it of t.items) {
        if (it.kind !== 'clip') continue;
        const itStart = it.timelineRange.startUs;
        const center = itStart + it.timelineRange.durationUs / 2;

        if (center >= cutUs && center <= endUs) {
          toDelete.push(it.id);
        }
      }

      if (toDelete.length > 0) {
        deps.applyTimeline(
          { type: 'delete_items', trackId: t.id, itemIds: toDelete, ignoreLocks: true },
          { saveMode: 'none', historyMode: 'debounced', historyDebounceMs: 100 },
        );
      }
    }

    const afterDelete = deps.getDoc();
    if (!afterDelete) return;

    const EPSILON = 10;
    for (const t of afterDelete.tracks) {
      const clips = t.items
        .filter((it): it is TimelineClipItem => it.kind === 'clip')
        .slice()
        .sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);

      for (const clip of clips) {
        const clipStart = clip.timelineRange.startUs;
        if (clipStart >= endUs - EPSILON) {
          deps.applyTimeline(
            {
              type: 'move_item',
              trackId: t.id,
              itemId: clip.id,
              startUs: Math.max(0, clipStart - deltaUs),
              ignoreLocks: true,
            },
            { saveMode: 'none', historyMode: 'debounced', historyDebounceMs: 100 },
          );
        }
      }
    }

    await deps.requestTimelineSave({ immediate: true });
  }

  async function advancedRippleTrimLeft() {
    const doc = deps.getDoc();
    if (!doc) return;

    if (deps.getSelectedItemIds().length !== 1) return;
    const target = deps.getHotkeyTargetClip();
    if (!target) return;

    const track = getTrackById(doc, target.trackId);
    const item = track?.items.find((it) => it.kind === 'clip' && it.id === target.itemId) ?? null;
    if (!track || !item || item.kind !== 'clip') return;

    const cutUs = deps.computeCutUs(doc, deps.getCurrentTime());
    const startUs = item.timelineRange.startUs;
    const endUs = startUs + item.timelineRange.durationUs;

    if (!(cutUs > startUs && cutUs < endUs)) return;

    const deltaUs = cutUs - startUs;
    if (deltaUs <= 0) return;

    const splitAt = (atUs: number) => {
      for (const t of doc.tracks) {
        for (const it of t.items) {
          if (it.kind !== 'clip') continue;
          const itStart = it.timelineRange.startUs;
          const itEnd = itStart + it.timelineRange.durationUs;
          if (atUs > itStart && atUs < itEnd) {
            deps.applyTimeline(
              { type: 'split_item', trackId: t.id, itemId: it.id, atUs, ignoreLocks: true },
              { saveMode: 'none', historyMode: 'debounced', historyDebounceMs: 100 },
            );
          }
        }
      }
    };

    splitAt(cutUs);
    splitAt(startUs);

    const updated = deps.getDoc();
    if (!updated) return;

    for (const t of updated.tracks) {
      const toDelete: string[] = [];
      for (const it of t.items) {
        if (it.kind !== 'clip') continue;
        const itStart = it.timelineRange.startUs;
        const center = itStart + it.timelineRange.durationUs / 2;

        if (center >= startUs && center <= cutUs) {
          toDelete.push(it.id);
        }
      }

      if (toDelete.length > 0) {
        deps.applyTimeline(
          { type: 'delete_items', trackId: t.id, itemIds: toDelete, ignoreLocks: true },
          { saveMode: 'none', historyMode: 'debounced', historyDebounceMs: 100 },
        );
      }
    }

    const afterDelete = deps.getDoc();
    if (!afterDelete) return;

    const EPSILON = 10;
    for (const t of afterDelete.tracks) {
      const clips = t.items
        .filter((it): it is TimelineClipItem => it.kind === 'clip')
        .slice()
        .sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);

      for (const clip of clips) {
        const clipStart = clip.timelineRange.startUs;
        if (clipStart >= cutUs - EPSILON) {
          deps.applyTimeline(
            {
              type: 'move_item',
              trackId: t.id,
              itemId: clip.id,
              startUs: Math.max(0, clipStart - deltaUs),
              ignoreLocks: true,
            },
            { saveMode: 'none', historyMode: 'debounced', historyDebounceMs: 100 },
          );
        }
      }
    }

    await deps.requestTimelineSave({ immediate: true });
  }

  return {
    rippleTrimRight,
    rippleTrimLeft,
    advancedRippleTrimRight,
    advancedRippleTrimLeft,
    rippleDeleteRange,
  };
}
