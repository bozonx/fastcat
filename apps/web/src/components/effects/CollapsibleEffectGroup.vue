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
  <div class="effect-group space-y-1">
    <button
      class="flex items-center gap-1.5 w-full text-left font-semibold text-ui-text group py-0.5"
      @click="toggle"
    >
      <UIcon
        :name="isCollapsed ? 'i-heroicons-chevron-right' : 'i-heroicons-chevron-down'"
        class="w-3.5 h-3.5 text-ui-text-muted group-hover:text-ui-text transition-colors shrink-0"
      />
      <span
        class="text-2xs font-semibold tracking-wider text-ui-text-muted group-hover:text-ui-text transition-colors"
      >
        {{ title }}
      </span>
    </button>

    <div v-show="!isCollapsed" class="effect-group-content space-y-1">
      <slot />
    </div>
  </div>
</template>
