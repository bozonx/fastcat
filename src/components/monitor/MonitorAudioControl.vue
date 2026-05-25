<script setup lang="ts">
import { computed } from 'vue';
import { useUiStore } from '~/stores/ui.store';
import { storeToRefs } from 'pinia';
import UiVolumeControl from '~/components/ui/editor/UiVolumeControl.vue';
import { useHotkeyLabel } from '~/composables/useHotkeyLabel';

defineProps<{
  compact?: boolean;
}>();

const uiStore = useUiStore();
const { monitorVolume, monitorMuted } = storeToRefs(uiStore);
const { getHotkeyLabel } = useHotkeyLabel();
const { t } = useI18n();

const combinedVolumeTooltip = computed(() => {
  const muteLabel = getHotkeyLabel('general.mute');
  const upLabel = getHotkeyLabel('general.volumeUp');
  const downLabel = getHotkeyLabel('general.volumeDown');

  let text = t('fastcat.monitor.toggleMute');
  if (muteLabel) text += ` (${muteLabel})`;

  const extras = [];
  if (upLabel) extras.push(`${t('fastcat.monitor.volumeUp')} (${upLabel})`);
  if (downLabel) extras.push(`${t('fastcat.monitor.volumeDown')} (${downLabel})`);

  if (extras.length > 0) {
    text += ` | ${extras.join(' | ')}`;
  }
  return text;
});
</script>

<template>
  <UiVolumeControl
    v-model:volume="monitorVolume"
    v-model:is-muted="monitorMuted"
    wheel-without-focus
    :compact="compact"
    orientation="vertical"
    :max="2"
    :mute-tooltip="combinedVolumeTooltip"
  />
</template>
