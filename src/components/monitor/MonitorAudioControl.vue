<script setup lang="ts">
import { useUiStore } from '~/stores/ui.store';
import { storeToRefs } from 'pinia';
import UiVolumeControl from '~/components/ui/editor/UiVolumeControl.vue';
import { useHotkeyLabel } from '~/composables/useHotkeyLabel';

const props = defineProps<{
  compact?: boolean;
}>();

const uiStore = useUiStore();
const { monitorVolume, monitorMuted } = storeToRefs(uiStore);
const { getHotkeyTitle } = useHotkeyLabel();
const { t } = useI18n();
</script>

<template>
  <UiVolumeControl
    v-model:volume="monitorVolume"
    v-model:is-muted="monitorMuted"
    wheel-without-focus
    :compact="compact"
    orientation="vertical"
    :max="2"
    :mute-tooltip="getHotkeyTitle(t('fastcat.monitor.toggleMute'), 'general.mute')"
    :volume-up-tooltip="
      getHotkeyTitle(t('fastcat.monitor.volumeUp'), 'general.volumeUp')
    "
    :volume-down-tooltip="
      getHotkeyTitle(t('fastcat.monitor.volumeDown'), 'general.volumeDown')
    "
  />
</template>
