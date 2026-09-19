<script setup lang="ts">
import UiModal from '~/components/ui/UiModal.vue';
import MobileAppSettingsPanel from '~/components/settings/MobileAppSettingsPanel.vue';

/**
 * The embed's settings, opened over the editor.
 *
 * The desktop shell has no settings view to switch to — `EditorView` knows the
 * name, but only the touch shell renders one — so in a desktop-sized embed the
 * preferences have to arrive as a dialog. The panel decides for itself which
 * sections an embedded session may show.
 */
const isOpen = defineModel<boolean>('open', { required: true });

const { t } = useI18n();
</script>

<template>
  <UiModal
    v-model:open="isOpen"
    :title="t('videoEditor.settings.title')"
    :ui="{
      content: 'sm:max-w-3xl h-[85vh]',
      body: '!p-0 !overflow-hidden flex flex-col',
    }"
  >
    <MobileAppSettingsPanel class="flex-1 min-h-0" data-testid="embed-settings-panel" />
  </UiModal>
</template>
