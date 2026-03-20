<script setup lang="ts">
/**
 * Unified Tabs Component (Wrapper over UTabs)
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
  border?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

import { computed } from 'vue';

const items = computed(() =>
  props.options.map((opt) => ({
    ...opt,
    slot: opt.value,
  }))
);

const selectedIndex = computed({
  get: () => {
    const idx = props.options.findIndex((opt) => opt.value === props.modelValue);
    return idx === -1 ? 0 : idx;
  },
  set: (idx: number) => {
    if (props.options[idx]) {
      emit('update:modelValue', props.options[idx].value);
    }
  },
});
</script>

<template>
  <div :class="{ 'border-b border-ui-border': border }">
    <UTabs
      v-model="selectedIndex"
      :items="items"
      :ui="{
        list: {
          base: 'px-3 py-2 gap-4 bg-transparent',
          padding: 'p-0',
          rounded: 'rounded-none',
          tab: {
            base: 'text-xs font-semibold uppercase tracking-wider transition-colors outline-none cursor-pointer whitespace-nowrap',
            active: 'text-primary-400 bg-transparent',
            inactive: 'text-ui-text-muted hover:text-ui-text bg-transparent',
            padding: 'px-0 py-0',
          },
        },
      }"
    >
      <template #default="{ item, index, selected }">
        <div class="flex items-center gap-2">
          <UIcon v-if="item.icon" :name="item.icon" class="w-4 h-4" />
          <span>{{ item.label }}</span>
          <span v-if="item.count !== undefined" class="ml-1 opacity-50 font-mono text-[10px]">
            ({{ item.count }})
          </span>
        </div>
      </template>
    </UTabs>
  </div>
</template>
