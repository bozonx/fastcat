<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref } from 'vue';
import type { TimelineTrack, TimelineTrackItem } from '~/timeline/types';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useAppClipboard } from '~/composables/useAppClipboard';
import { timelineRangeToRoundedPx } from '~/utils/timeline/geometry';

import { isLayer1Active, isLayer2Active } from '~/utils/hotkeys/layerUtils';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useTrackContextMenu } from '~/composables/timeline/useTrackContextMenu';
import { useExclusiveContextMenu } from '~/composables/ui/useExclusiveContextMenu';
import UiRenameModal from '~/components/ui/UiRenameModal.vue';

const { t } = useI18n();
const timelineStore = useTimelineStore();
const selectionStore = useSelectionStore();
const clipboardStore = useAppClipboard();

const hasTimelineClipboard = computed(() => clipboardStore.hasTimelinePayload);
const { isContextMenuOpen, setContextMenuOpen } = useExclusiveContextMenu();

function onPaste() {
  const payload = clipboardStore.clipboardPayload;
  if (!payload || payload.source !== 'timeline' || payload.items.length === 0) return;
  void timelineStore.pasteClips(payload.items, {
    insertStartUs: props.item.timelineRange.startUs,
  });
  if (payload.operation === 'cut') clipboardStore.setClipboardPayload(null);
}

const isTrackRenameModalOpen = ref(false);
const trackToRename = ref<TimelineTrack | null>(null);

function handleRenameTrack(name: string) {
  if (trackToRename.value) {
    const trimmed = name.trim();
    if (trimmed && trimmed !== trackToRename.value.name) {
      timelineStore.renameTrack(trackToRename.value.id, trimmed);
    }
  }
  isTrackRenameModalOpen.value = false;
  trackToRename.value = null;
}

const { getTrackContextMenuItems } = useTrackContextMenu({
  onRequestDelete: (track) => timelineStore.deleteTrack(track.id, { allowNonEmpty: true }),
  onRequestRename: (track) => {
    trackToRename.value = track;
    isTrackRenameModalOpen.value = true;
  },
});

const trackContextMenuItems = computed(() => {
  const tracks = timelineStore.timelineDoc?.tracks ?? [];
  const track = tracks.find((t) => t.id === props.trackId);
  if (!track) return [];
  return getTrackContextMenuItems(track, tracks);
});

const props = defineProps<{
  item: TimelineTrackItem;
  trackId: string;
  isMobile?: boolean;
}>();

const emit = defineEmits<{
  (e: 'select', event: PointerEvent): void;
  (e: 'marqueeStart', event: PointerEvent): void;
}>();

let pointerStartX = 0;
let pointerStartY = 0;
let rightClickCleanup: (() => void) | null = null;
const gapRef = ref<HTMLElement | null>(null);

const style = computed(() => {
  const geometry = timelineRangeToRoundedPx(
    props.item.timelineRange,
    timelineStore.timelineZoom,
    2,
  );
  return {
    left: `${geometry.leftPx}px`,
    width: `${geometry.widthPx}px`,
  };
});

const isSelected = computed(() => {
  if (timelineStore.selectedItemIds.includes(props.item.id)) {
    return true;
  }

  const selectedEntity = selectionStore.selectedEntity;
  return (
    selectedEntity?.source === 'timeline' &&
    selectedEntity.kind === 'gap' &&
    selectedEntity.trackId === props.trackId &&
    selectedEntity.itemId === props.item.id
  );
});

function onDelete() {
  timelineStore.applyTimeline({
    type: 'delete_items',
    trackId: props.trackId,
    itemIds: [props.item.id],
  });
  timelineStore.clearSelection();
  selectionStore.clearSelection();
}

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
  if (props.isMobile) return false;

  const action = resolveTimelineDragAction(e);
  return action === 'move_clips' || action === 'select_area';
}

function openContextMenuFromRightClick(e: PointerEvent) {
  if (rightClickCleanup) rightClickCleanup();

  const clientX = e.clientX;
  const clientY = e.clientY;

  const cleanup = () => {
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', cleanup);
    rightClickCleanup = null;
  };

  const onPointerUp = () => {
    cleanup();
    void nextTick().then(() => {
      gapRef.value?.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
        }),
      );
    });
  };

  rightClickCleanup = cleanup;
  window.addEventListener('pointerup', onPointerUp, { once: true });
  window.addEventListener('pointercancel', cleanup, { once: true });
}

function onPointerdown(e: PointerEvent) {
  if (shouldStartMarquee(e)) {
    // Emit marqueeStart directly so startMarquee handles click vs drag distinction:
    // on click → onClick callback selects the gap; on drag → starts marquee selection
    e.stopPropagation();
    emit('marqueeStart', e);
    return;
  }

  if (e.button === 1) return;

  e.stopPropagation();

  if (e.button === 2) {
    e.preventDefault();
    openContextMenuFromRightClick(e);
    return;
  }

  if (props.isMobile && e.pointerType === 'touch' && e.button === 0) {
    // On mobile, record position for movement check — actual selection happens in onClick
    pointerStartX = e.clientX;
    pointerStartY = e.clientY;
    return;
  }

  if (e.button === 0) {
    emit('select', e);
  }
}

function onClick(e: MouseEvent) {
  if (!props.isMobile) return;
  // Skip if this was a scroll gesture (significant pointer movement)
  const dx = Math.abs(e.clientX - pointerStartX);
  const dy = Math.abs(e.clientY - pointerStartY);
  if (dx > 5 || dy > 5) return;
  emit('select', e as unknown as PointerEvent);
}

function onContextMenu(e: MouseEvent) {
  if (!e.isTrusted) return;
  e.preventDefault();
  e.stopPropagation();
}

onScopeDispose(() => {
  if (rightClickCleanup) rightClickCleanup();
});
</script>

<template>
  <UContextMenu
    :open="isContextMenuOpen"
    :items="[
      [
        {
          label: t('fastcat.timeline.delete'),
          icon: 'i-heroicons-trash',
          onSelect: onDelete,
        },
        {
          label: t('common.paste'),
          icon: 'i-heroicons-clipboard',
          disabled: !hasTimelineClipboard,
          onSelect: onPaste,
        },
      ],
      ...trackContextMenuItems,
    ]"
    :disabled="isMobile"
    @update:open="setContextMenuOpen"
  >
    <div
      ref="gapRef"
      :data-gap-id="item.id"
      class="absolute top-0.5 bottom-0.5 rounded border border-dashed transition-colors z-10 cursor-pointer select-none"
      :class="[
        isSelected
          ? 'border-primary-500 bg-primary-500/15 hover:bg-primary-500/25'
          : 'border-ui-border/50 bg-ui-bg-elevated/20 hover:bg-ui-bg-elevated/40',
        isMobile && isSelected ? 'touch-none' : '',
      ]"
      :style="style"
      @pointerdown="onPointerdown"
      @click.stop="onClick"
      @contextmenu="onContextMenu"
    />
  </UContextMenu>

  <UiRenameModal
    :open="isTrackRenameModalOpen"
    :current-name="trackToRename?.name || ''"
    :title="t('fastcat.timeline.renameTrack')"
    @update:open="isTrackRenameModalOpen = $event"
    @rename="handleRenameTrack"
  />
</template>
