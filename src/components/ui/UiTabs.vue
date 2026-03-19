<script setup lang="ts">
/**
 * Unified Tabs Component
 *
 * Provides a consistent look for tab-style navigation.
 */

interface TabOption {
  label: string;
  value: string;
  count?: number;
  icon?: string;
}

const props = defineProps<{
  modelValue: string;
  options: TabOption[];
  /** Whether to show a bottom border on the container */
  border?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const { t } = useI18n();

function select(value: string) {
  emit('update:modelValue', value);
}
</script>

<template>
  <div
    class="flex items-center gap-4 px-3 py-2 shrink-0 select-none overflow-x-auto no-scrollbar"
    :class="{ 'border-b border-ui-border': border }"
  >
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider transition-colors outline-none cursor-pointer whitespace-nowrap"
      :class="
        modelValue === option.value ? 'text-primary-400' : 'text-ui-text-muted hover:text-ui-text'
      "
      @click="select(option.value)"
    >
      <UIcon v-if="option.icon" :name="option.icon" class="w-4 h-4" />
      <span>{{ option.label }}</span>
      <span v-if="option.count !== undefined" class="ml-1 opacity-50 font-mono text-[10px]">
        ({{ option.count }})
      </span>
    </button>
  </div>
</template>

<style scoped>
.no-scrollbar {
  scrollbar-width: none;
}
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
</style>
