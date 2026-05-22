<script setup lang="ts">
import { provide } from 'vue';

const props = defineProps<{
  store: unknown;
}>();

provide('fileManagerStore', props.store);
</script>

<template>
  <slot />
</template>
