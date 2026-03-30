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
  options: TabOption[];
  border?: boolean;
}>();

const modelValue = defineModel<string>({ required: true });

const items = computed(() =>
  props.options.map((opt) => ({
    ...opt,
    slot: opt.value,
  })),
);
</script>

<template>
  <div :class="{ 'border-b border-ui-border': border }">
    <UTabs
      v-model="modelValue"
      :items="items"
      :ui="{
        root: 'gap-4',
        list: 'px-3 py-2 gap-4 bg-transparent p-0 rounded-none',
        trigger:
          'text-xs font-semibold uppercase tracking-wider transition-colors outline-none cursor-pointer whitespace-nowrap px-0 py-0 data-[state=active]:text-primary-400 data-[state=active]:bg-transparent data-[state=inactive]:text-ui-text-muted data-[state=inactive]:hover:text-ui-text data-[state=inactive]:bg-transparent',
      }"
    >
      <template #default="{ item }">
        <div v-if="item" class="flex items-center gap-2">
          <UIcon v-if="item.icon" :name="item.icon" class="w-4 h-4" />
          <span>{{ item.label }}</span>
          <span v-if="item.count !== undefined" class="ml-1 opacity-50 font-mono text-2xs">
            ({{ item.count }})
          </span>
        </div>
      </template>
    </UTabs>
  </div>
</template>
