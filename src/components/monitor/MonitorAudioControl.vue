<script setup lang="ts">
import { useUiStore } from '~/stores/ui.store';
import { storeToRefs } from 'pinia';
import VolumeControl from '~/components/common/VolumeControl.vue';

const props = defineProps<{
  compact?: boolean;
}>();

const uiStore = useUiStore();
const { monitorVolume, monitorMuted } = storeToRefs(uiStore);
</script>

<template>
  <VolumeControl
    v-model:volume="monitorVolume"
    v-model:is-muted="monitorMuted"
    :compact="compact"
    orientation="vertical"
    :max="2"
  />
</template>
