<script setup lang="ts">
import { provide } from 'vue';
import type { FileManagerStore } from '~/stores/file-manager.store';

const props = defineProps<{
  store: any;
}>();

provide('fileManagerStore', props.store);
</script>

<template>
  <slot />
</template>
