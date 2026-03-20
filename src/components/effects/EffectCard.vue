<script setup lang="ts">
import type { EffectManifest } from '~/effects';

const props = defineProps<{
  manifest: EffectManifest<any>;
  isSelected?: boolean;
  isDraggable?: boolean;
  showAction?: boolean;
  actionIcon?: string;
  actionColor?: string;
}>();

const emit = defineEmits<{
  click: [];
  action: [];
  dragstart: [event: DragEvent];
}>();

function onDragStart(e: DragEvent) {
  if (props.isDraggable) {
    emit('dragstart', e);
  }
}
</script>

<template>
  <div
    class="flex items-start gap-3 p-3 rounded-lg border transition-colors group relative"
    :class="[
      isSelected
        ? 'border-primary bg-primary/10'
        : 'border-ui-border bg-ui-bg-muted hover:bg-ui-bg-elevated',
      isDraggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
    ]"
    :draggable="isDraggable"
    @dragstart="onDragStart"
    @click="emit('click')"
  >
    <UIcon :name="manifest.icon" class="w-8 h-8 text-primary shrink-0" />
    <div class="flex-1 min-w-0">
      <div class="flex items-center justify-between gap-2">
        <h4 class="text-sm font-medium text-ui-text truncate">{{ manifest.name }}</h4>
        <UButton
          v-if="showAction"
          :icon="actionIcon || 'i-heroicons-trash'"
          :color="(actionColor as any) || 'red'"
          variant="ghost"
          size="xs"
          class="opacity-0 group-hover:opacity-100 transition-opacity"
          @click.stop="emit('action')"
        />
      </div>
      <p
        v-if="manifest.description"
        class="text-xs text-ui-text-muted mt-1 line-clamp-2"
        :title="manifest.description"
      >
        {{ manifest.description }}
      </p>
    </div>
    <div v-if="!showAction && !isDraggable" class="shrink-0 flex items-center self-center">
      <UIcon
        name="i-heroicons-plus-circle"
        class="w-5 h-5 text-ui-text-muted opacity-0 group-hover:opacity-100 transition-opacity"
      />
    </div>
  </div>
</template>
