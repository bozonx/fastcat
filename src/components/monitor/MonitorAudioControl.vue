<script setup lang="ts">
import { useUiStore } from '~/stores/ui.store';
import { storeToRefs } from 'pinia';
import UiVolumeControl from '~/components/ui/editor/UiVolumeControl.vue';

const props = defineProps<{
  compact?: boolean;
}>();

const uiStore = useUiStore();
const { monitorVolume, monitorMuted } = storeToRefs(uiStore);
</script>

<template>
  <UiVolumeControl
    v-model:volume="monitorVolume"
    v-model:is-muted="monitorMuted"
    :compact="compact"
    orientation="vertical"
    :max="2"
  />
</template>
