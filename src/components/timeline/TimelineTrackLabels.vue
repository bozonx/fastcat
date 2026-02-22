<script setup lang="ts">
import type { TimelineTrack } from '~/timeline/types';

defineProps<{
  tracks: TimelineTrack[];
}>();
</script>

<template>
  <div class="w-28 shrink-0 border-r border-gray-700 flex flex-col">
    <div class="h-6 border-b border-gray-700 bg-gray-850" />
    <div class="flex flex-col divide-y divide-gray-700 flex-1">
      <div
        v-for="track in tracks"
        :key="track.id"
        class="flex items-center px-2 h-10 text-xs text-gray-500 font-medium"
      >
        {{ track.name }}
      </div>
    </div>
  </div>
</template>
