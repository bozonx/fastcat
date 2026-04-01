<script setup lang="ts">
const props = defineProps<{
  label: string;
  value?: string | number | null;
}>();
</script>

<template>
  <div
    class="grid grid-cols-[110px_1fr] gap-x-3 items-start py-1 px-2 -mx-2 rounded hover:bg-white/5 transition-colors cursor-default"
  >
    <div class="text-sm text-ui-text-muted wrap-break-word">
      {{ props.label }}
    </div>
    <div class="text-sm text-ui-text wrap-break-word min-w-0">
      <slot>
        {{ props.value ?? '-' }}
      </slot>
    </div>
  </div>
</template>
