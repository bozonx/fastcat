<script setup lang="ts">
const props = defineProps<{
  label: string;
  value?: string | number | null;
}>();
</script>

<template>
  <div class="grid grid-cols-[110px_1fr] gap-x-3 items-start py-0.5 px-1.5 -mx-1.5 rounded-sm hover:bg-ui-surface-hover transition-colors cursor-default">
    <div class="text-xs text-ui-text-muted truncate">
      {{ props.label }}
    </div>
    <div class="text-xs text-ui-text wrap-break-word min-w-0">
      <slot>
        {{ props.value ?? '-' }}
      </slot>
    </div>
  </div>
</template>
