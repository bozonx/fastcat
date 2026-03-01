<script setup lang="ts">
import { useGlobalDragAndDrop } from '~/composables/editor/useGlobalDragAndDrop';

const { onGlobalDragOver, onGlobalDragLeave, onGlobalDrop } = useGlobalDragAndDrop();
</script>

<template>
  <div
    class="flex flex-col h-screen w-screen overflow-hidden bg-ui-bg text-ui-text"
    @dragover.prevent="onGlobalDragOver"
    @dragleave.prevent="onGlobalDragLeave"
    @drop.prevent="onGlobalDrop"
  >
    <slot />
  </div>
</template>
