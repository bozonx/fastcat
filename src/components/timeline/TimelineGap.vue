<script setup lang="ts">
import type { TimelineTrackItem } from '~/timeline/types';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useAppClipboard } from '~/composables/useAppClipboard';
import { timeUsToPx } from '~/utils/timeline/geometry';

const { t } = useI18n();
const timelineStore = useTimelineStore();
const selectionStore = useSelectionStore();
const clipboardStore = useAppClipboard();

const hasTimelineClipboard = computed(() => clipboardStore.hasTimelinePayload);

function onPaste() {
  const payload = clipboardStore.clipboardPayload;
  if (!payload || payload.source !== 'timeline' || payload.items.length === 0) return;
  timelineStore.pasteClips(payload.items, {
    insertStartUs: props.item.timelineRange.startUs,
  });
  if (payload.operation === 'cut') clipboardStore.setClipboardPayload(null);
}

const props = defineProps<{
  item: TimelineTrackItem;
  trackId: string;
}>();

const emit = defineEmits<{
  (e: 'select', event: PointerEvent): void;
  (e: 'marqueeStart', event: PointerEvent): void;
}>();

const style = computed(() => ({
  left: `${timeUsToPx(props.item.timelineRange.startUs, timelineStore.timelineZoom)}px`,
  width: `${Math.max(2, timeUsToPx(props.item.timelineRange.durationUs, timelineStore.timelineZoom))}px`,
}));

const isSelected = computed(() => timelineStore.selectedItemIds.includes(props.item.id));

function onDelete() {
  timelineStore.applyTimeline({
    type: 'delete_items',
    trackId: props.trackId,
    itemIds: [props.item.id],
  });
  timelineStore.clearSelection();
  selectionStore.clearSelection();
}

import { isLayer1Active, isLayer2Active } from '~/utils/hotkeys/layerUtils';
import { useWorkspaceStore } from '~/stores/workspace.store';

const workspaceStore = useWorkspaceStore();

function resolveTimelineDragAction(e: PointerEvent): string {
  const settings = workspaceStore.userSettings.mouse.timeline;
  if (e.button === 1) return settings.middleDrag;
  if (e.button === 0) {
    if (isLayer1Active(e, workspaceStore.userSettings)) return settings.clipDragShift;
    if (isLayer2Active(e, workspaceStore.userSettings)) return settings.clipDragCtrl;
    return settings.drag;
  }
  if (e.button === 2) return settings.clipDragRight;
  return 'none';
}

function shouldStartMarquee(e: PointerEvent): boolean {
  const action = resolveTimelineDragAction(e);
  return action === 'move_clips' || action === 'select_area';
}

function onPointerdown(e: PointerEvent) {
  if (shouldStartMarquee(e)) {
    e.stopPropagation();
    emit('marqueeStart', e);
  } else if (e.button !== 1) {
    e.stopPropagation();
    emit('select', e);
  }
}
</script>

<template>
  <UContextMenu
    :items="[
      [
        {
          label: t('common.paste'),
          icon: 'i-heroicons-clipboard',
          disabled: !hasTimelineClipboard,
          onSelect: onPaste,
        },
        {
          label: t('fastcat.timeline.delete'),
          icon: 'i-heroicons-trash',
          onSelect: onDelete,
        },
      ],
    ]"
  >
    <div
      :data-gap-id="item.id"
      class="absolute top-0.5 bottom-0.5 rounded border border-dashed transition-colors z-10 cursor-pointer select-none"
      :class="
        isSelected
          ? 'border-primary-500 bg-primary-500/15 hover:bg-primary-500/25'
          : 'border-ui-border/50 bg-ui-bg-elevated/20 hover:bg-ui-bg-elevated/40'
      "
      :style="style"
      @pointerdown="onPointerdown"
    />
  </UContextMenu>
</template>
