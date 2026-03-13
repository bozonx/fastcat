<script setup lang="ts">
const props = defineProps<{
  title: string;
  isCollapsed: boolean;
}>();

const emit = defineEmits<{
  'update:isCollapsed': [value: boolean];
}>();

function toggle() {
  emit('update:isCollapsed', !props.isCollapsed);
}
</script>

<template>
  <div class="space-y-2">
    <button
      class="flex items-center gap-2 w-full text-left font-medium text-ui-text group"
      @click="toggle"
    >
      <UIcon
        :name="isCollapsed ? 'i-heroicons-chevron-right' : 'i-heroicons-chevron-down'"
        class="w-4 h-4 text-ui-text-muted group-hover:text-ui-text transition-colors"
      />
      <span class="uppercase text-xs tracking-wider text-ui-text-muted group-hover:text-ui-text transition-colors">
        {{ title }}
      </span>
    </button>

    <div v-show="!isCollapsed" class="pl-6 space-y-2">
      <slot />
    </div>
  </div>
</template>
