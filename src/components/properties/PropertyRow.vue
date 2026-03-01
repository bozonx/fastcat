<script setup lang="ts">
const props = defineProps<{
  label: string;
  value?: string | number | null;
}>();
</script>

<template>
  <div class="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 items-start">
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
