<script setup lang="ts">
import { ref } from 'vue';

interface ContextMenuItem {
  label: string;
  icon?: string;
  onSelect?: () => void;
}

interface Props {
  title: string;
  icon: string;
  isAbsolute?: boolean;
  draggableCursorClass?: string;
  contextMenuItems?: ContextMenuItem[][];
  inDevelopmentFeaturesEnabled?: boolean;
}

withDefaults(defineProps<Props>(), {
  isAbsolute: false,
  draggableCursorClass: 'cursor-grab active:cursor-grabbing',
  contextMenuItems: () => [],
  inDevelopmentFeaturesEnabled: false,
});

const emit = defineEmits<{
  dragStart: [event: DragEvent];
  close: [];
}>();

const isMenuOpen = ref(false);

function onContextMenu(event: MouseEvent) {
  event.stopPropagation();
}

function onDragStart(event: DragEvent) {
  isMenuOpen.value = false;
  emit('dragStart', event);
}

function isMiddleClick(event: MouseEvent) {
  return event.button === 1;
}

function onMouseDown(event: MouseEvent) {
  if (isMiddleClick(event)) {
    event.preventDefault();
  }
}

function onAuxClick(event: MouseEvent) {
  if (isMiddleClick(event)) {
    event.preventDefault();
    emit('close');
  }
}
</script>

<template>
  <UContextMenu v-model:open="isMenuOpen" :items="contextMenuItems">
    <div
      class="flex justify-between items-center px-4 py-2 border-b border-ui-border text-sm bg-ui-bg-elevated shrink-0 select-none"
      :class="[
        isAbsolute ? 'absolute top-0 left-0 right-0 z-20' : '',
        inDevelopmentFeaturesEnabled ? draggableCursorClass : '',
      ]"
      :draggable="inDevelopmentFeaturesEnabled"
      @dragstart="onDragStart"
      @dblclick="emit('close')"
      @contextmenu="onContextMenu"
      @mousedown="onMouseDown"
      @auxclick="onAuxClick"
    >
      <div class="flex items-center gap-2 min-w-0 flex-1 pr-2">
        <UIcon :name="icon" class="w-4 h-4 text-ui-text-muted shrink-0" />
        <h3 class="font-bold truncate min-w-0" :title="title">
          {{ title }}
        </h3>
      </div>
      <UiActionButton
        class="shrink-0"
        size="xs"
        variant="ghost"
        color="neutral"
        icon="i-heroicons-x-mark"
        @click="emit('close')"
      />
    </div>
  </UContextMenu>
</template>
