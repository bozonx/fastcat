<script setup lang="ts">
import UiModal from '~/components/ui/UiModal.vue';
import ExportForm from '~/components/export/ExportForm.vue';

/**
 * The full export form over the editor. In an embed an export is an action on
 * the toolbar, not a place to go, so its settings open here rather than as a
 * view the user then has to find their way back from.
 */
const props = defineProps<{
  /** Held open while a render runs: closing would hide its progress and cancel. */
  isExporting: boolean;
}>();

const isOpen = defineModel<boolean>('open', { required: true });

const { t } = useI18n();
</script>

<template>
  <UiModal
    v-model:open="isOpen"
    :title="t('fastcat.embed.exportSettingsTitle')"
    :prevent-close="props.isExporting"
    :close-button="!props.isExporting"
    :ui="{
      content: 'sm:max-w-3xl h-[85vh]',
      body: '!p-0 !overflow-hidden flex flex-col',
    }"
  >
    <ExportForm detached class="flex-1 min-h-0" data-testid="embed-export-settings" />
  </UiModal>
</template>
