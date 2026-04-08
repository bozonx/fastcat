import type { ComputedRef } from 'vue';
import { computed } from 'vue';

import type { TimelineTrack } from '~/timeline/types';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { isLayer1Active, isLayer2Active } from '~/utils/hotkeys/layerUtils';
import { getLinkedClipGroupItemIds } from '~/timeline/commands/utils';

export function useTimelineItemSelection(
  tracks: ComputedRef<TimelineTrack[]>,
  isMobile?: Ref<boolean>,
) {
  const timelineStore = useTimelineStore();
  const projectStore = useProjectStore();
  const selectionStore = useSelectionStore();
  const workspaceStore = useWorkspaceStore();

  const canOpenClipProperties = computed(
    () =>
      projectStore.currentView === 'files' ||
      projectStore.currentView === 'cut' ||
      projectStore.currentView === 'sound',
  );

  function selectItem(e: PointerEvent, itemId: string) {
    const isMulti =
      isLayer1Active(e, workspaceStore.userSettings) ||
      isLayer2Active(e, workspaceStore.userSettings);

    const doc = timelineStore.timelineDoc;
    const item = tracks.value.flatMap((t) => t.items).find((i) => i.id === itemId);
    const kind = item?.kind ?? 'clip';
    const groupedIds = doc && kind === 'clip' ? getLinkedClipGroupItemIds(doc, itemId) : [itemId];
    let nextSelectedIds: string[] = [];

    if (isMulti) {
      const nextSelectedIdSet = new Set(timelineStore.selectedItemIds);
      const allGroupedSelected = groupedIds.every((id) => nextSelectedIdSet.has(id));
      if (allGroupedSelected) {
        for (const id of groupedIds) nextSelectedIdSet.delete(id);
      } else {
        for (const id of groupedIds) nextSelectedIdSet.add(id);
      }
      nextSelectedIds = [...nextSelectedIdSet];
      timelineStore.selectTimelineItems(nextSelectedIds);
    } else {
      const trackId = tracks.value.find((t) => t.items.some((i) => i.id === itemId))?.id;
      const isTouchPointer = e.pointerType === 'touch' || (isMobile?.value && e.pointerType === '');

      const isCurrentItemFullySelected =
        timelineStore.selectedItemIds.length === groupedIds.length &&
        groupedIds.every((id) => timelineStore.selectedItemIds.includes(id)) &&
        selectionStore.selectedEntity?.source === 'timeline' &&
        selectionStore.selectedEntity?.kind === kind &&
        (kind !== 'gap' || selectionStore.selectedEntity.itemId === itemId);

      if (trackId && isCurrentItemFullySelected && !isMobile?.value && !isTouchPointer) {
        timelineStore.clearSelection();
        timelineStore.selectTrack(trackId);
        selectionStore.selectTimelineTrack(trackId);
        return;
      }

      nextSelectedIds = groupedIds;
      timelineStore.selectTrack(null);
      timelineStore.selectTimelineItems(
        groupedIds.map((id) => ({
          trackId: trackId ?? '',
          itemId: id,
          kind: kind as 'clip' | 'gap',
        })),
      );
    }

    const items = tracks.value
      .flatMap((t) => t.items.map((it) => ({ trackId: t.id, item: it })))
      .filter((x) => nextSelectedIds.includes(x.item.id))
      .map((x) => ({ trackId: x.trackId, itemId: x.item.id, kind: x.item.kind }));

    if (canOpenClipProperties.value) {
      selectionStore.selectTimelineItems(items);
      return;
    }

    const selectedEntity = selectionStore.selectedEntity;
    if (selectedEntity?.source === 'timeline' && selectedEntity.kind !== 'marker') {
      selectionStore.clearSelection();
    }
  }

  return {
    selectItem,
  };
}
