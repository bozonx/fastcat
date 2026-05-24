import { computed } from 'vue';
import type { TimelineTrack, TimelineTrackItem } from '~/timeline/types';
import { timelineRangeToRoundedPx } from '~/utils/timeline/geometry';
import {
  buildClipRenderMemo,
  buildTrackVisibilityIndex,
  selectVisibleItems,
  type ItemGeometry,
  type TrackVisibilityIndexEntry,
} from '~/utils/timeline/track-virtualization';

const OVERSCAN_PX = 480;
const DEFAULT_TRACK_HEIGHT = 40;

export interface TrackVirtualizationDeps {
  tracks: () => TimelineTrack[];
  trackHeights: () => Record<string, number>;
  scrollLeft: () => number;
  viewportWidth: () => number;
  zoom: () => number;
  hoveredTrackId: () => string | null;
  isTrackDirectlySelected: (trackId: string) => boolean;
  isTrackVisuallySelected: (trackId: string) => boolean;
}

/**
 * Owns the timeline track windowing/view-model pipeline that was inline in
 * `TimelineTracks.vue`: pixel geometry → per-track visibility index → visible
 * items → render-ready track view models (selection state, colors, memo key).
 *
 * All reactivity flows through the getter deps, so the returned computeds stay
 * as reactive as the original inline versions.
 */
export function useTimelineTrackVirtualization(deps: TrackVirtualizationDeps) {
  /** Pre-calculate pixel geometries for items to avoid recomputing per scroll/render frame. */
  const itemGeometries = computed(() => {
    const zoom = deps.zoom();
    const map = new Map<string, ItemGeometry>();
    for (const track of deps.tracks()) {
      for (const item of track.items) {
        const geometry = timelineRangeToRoundedPx(item.timelineRange, zoom, 2);
        map.set(item.id, {
          startPx: geometry.leftPx,
          widthPx: geometry.widthPx,
          endPx: geometry.endPx,
        });
      }
    }
    return map;
  });

  const trackVisibilityIndexByTrack = computed<Record<string, TrackVisibilityIndexEntry>>(() => {
    const result: Record<string, TrackVisibilityIndexEntry> = {};
    const geos = itemGeometries.value;
    for (const track of deps.tracks()) {
      result[track.id] = buildTrackVisibilityIndex(track.items, geos);
    }
    return result;
  });

  const visibleStartPx = computed(() => Math.max(0, deps.scrollLeft() - OVERSCAN_PX));
  const visibleEndPx = computed(() => {
    const vw = deps.viewportWidth();
    if (vw <= 0) return Infinity;
    return deps.scrollLeft() + vw + OVERSCAN_PX;
  });

  const visibleItemsByTrack = computed(() => {
    const result: Record<string, TimelineTrackItem[]> = {};
    const vStart = visibleStartPx.value;
    const vEnd = visibleEndPx.value;
    const geos = itemGeometries.value;
    const visibilityIndexByTrack = trackVisibilityIndexByTrack.value;

    for (const track of deps.tracks()) {
      result[track.id] = selectVisibleItems({
        items: track.items,
        geometries: geos,
        index: visibilityIndexByTrack[track.id],
        visibleStartPx: vStart,
        visibleEndPx: vEnd,
      });
    }
    return result;
  });

  const trackViewModels = computed(() => {
    const hoveredTrackId = deps.hoveredTrackId();
    const visibleItemsMap = visibleItemsByTrack.value;
    const trackHeights = deps.trackHeights();

    return deps.tracks().map((track) => {
      const isDirectlySelected = deps.isTrackDirectlySelected(track.id);
      const isVisuallySelected = deps.isTrackVisuallySelected(track.id);
      const isHovered = hoveredTrackId === track.id;
      const height = trackHeights[track.id] ?? DEFAULT_TRACK_HEIGHT;
      const visibleItems = visibleItemsMap[track.id] ?? [];

      return {
        track,
        height,
        isDirectlySelected,
        isVisuallySelected,
        isHovered,
        visibleItems,
        clipRenderMemo: visibleItems.map(buildClipRenderMemo).join('|'),
        selectionColor: track.color && track.color !== '#2a2a2a' ? `${track.color}80` : undefined,
        backgroundColor:
          track.color && track.color !== '#2a2a2a'
            ? isDirectlySelected
              ? `${track.color}40`
              : `${track.color}1a`
            : isDirectlySelected
              ? 'color-mix(in srgb, var(--selection-accent-500) 8%, transparent)'
              : undefined,
      };
    });
  });

  return {
    itemGeometries,
    visibleItemsByTrack,
    trackViewModels,
  };
}
