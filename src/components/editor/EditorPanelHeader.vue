<script setup lang="ts">
interface Props {
  title: string;
  icon: string;
  isAbsolute?: boolean;
}

withDefaults(defineProps<Props>(), {
  isAbsolute: false,
});

const emit = defineEmits<{
  dragStart: [event: DragEvent];
  close: [];
}>();
</script>

<template>
  <div
    class="flex justify-between items-center px-4 py-2 border-b border-ui-border text-sm bg-ui-bg-elevated cursor-grab active:cursor-grabbing shrink-0"
    :class="isAbsolute ? 'absolute top-0 left-0 right-0 z-20' : ''"
    draggable="true"
    @dragstart="emit('dragStart', $event)"
    @dblclick="emit('close')"
  >
    <div class="flex items-center gap-2 min-w-0 flex-1 pr-2">
      <UIcon :name="icon" class="w-4 h-4 text-ui-text-muted shrink-0" />
      <h3 class="font-bold truncate min-w-0" :title="title">
        {{ title }}
      </h3>
    </div>
    <UButton
      class="shrink-0"
      size="xs"
      variant="ghost"
      color="neutral"
      icon="i-heroicons-x-mark"
      @click="emit('close')"
    />
  </div>
</template>
