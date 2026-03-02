<script setup lang="ts">
const props = defineProps<{
  content: string;
}>();
</script>

<template>
  <div class="w-full h-full bg-ui-bg overflow-auto p-4">
    <pre class="text-xs font-mono text-ui-text whitespace-pre-wrap break-words">{{ props.content }}</pre>
  </div>
</template>
