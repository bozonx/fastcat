import { computed, toValue, type MaybeRefOrGetter } from 'vue';
import { useSelectionStore, type SelectedEntity } from '~/stores/selection.store';
import { useTimelineStore } from '~/stores/timeline.store';
import type { TimelineClipItem, TimelineTrack } from '~/timeline/types';

/**
 * Resolve the timeline clip + track referenced by a selection entity.
 *
 * Pure helper extracted so the (formerly copy-pasted) resolution logic has a
 * single source of truth. Returns `null` unless the entity points at an
 * existing timeline clip whose track and item are both still present.
 */
export function resolveSelectedClip(
  entity: SelectedEntity | null | undefined,
  tracks: readonly TimelineTrack[] | undefined,
): { track: TimelineTrack; item: TimelineClipItem } | null {
  if (entity?.source !== 'timeline' || entity.kind !== 'clip') return null;

  const track = tracks?.find((t) => t.id === entity.trackId) as TimelineTrack | undefined;
  if (!track) return null;

  const item = track.items.find((i) => i.id === entity.itemId) as TimelineClipItem | undefined;
  if (!item || item.kind !== 'clip') return null;

  return { track, item };
}

/**
 * Reactive accessors for the currently-selected timeline clip and its track.
 *
 * Pass `entitySource` to resolve against an explicit entity (e.g. a prop
 * override); omit it to track `selectionStore.selectedEntity`.
 */
export function useSelectedTimelineClip(
  entitySource?: MaybeRefOrGetter<SelectedEntity | null | undefined>,
) {
  const selectionStore = useSelectionStore();
  const timelineStore = useTimelineStore();

  const clipAndTrack = computed(() => {
    const entity =
      entitySource !== undefined ? toValue(entitySource) : selectionStore.selectedEntity;
    return resolveSelectedClip(
      entity,
      timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined,
    );
  });

  const clip = computed<TimelineClipItem | null>(() => clipAndTrack.value?.item ?? null);
  const track = computed<TimelineTrack | null>(() => clipAndTrack.value?.track ?? null);
  const trackKind = computed(() => track.value?.kind ?? 'video');
  const isLocked = computed(() => Boolean(clip.value?.locked || track.value?.locked));

  return { clipAndTrack, clip, track, trackKind, isLocked };
}
