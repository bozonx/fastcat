<script setup lang="ts">
import SettingsMouseSection from '~/components/settings/SettingsMouseSection.vue';
import SettingsMouseSelectRow from '~/components/settings/SettingsMouseSelectRow.vue';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { LAYER_OPTIONS, type LayerKey } from '~/utils/hotkeys/layerUtils';
import { useMouseSettings } from '~/composables/settings/useMouseSettings';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();

const isResetConfirmOpen = ref(false);

const {
  modifier1Name,
  modifier2Name,
  updateLayer1,
  updateLayer2,
  defaultLabel,
  sectionConfigs,
  resetDefaults,
  getSettingValue,
  updateSetting,
  isDefault,
  isModified,
} = useMouseSettings();

function handleResetDefaults() {
  resetDefaults();
  isResetConfirmOpen.value = false;
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <UiConfirmModal
      v-model:open="isResetConfirmOpen"
      :title="t('videoEditor.settings.resetMouseSettingsConfirmTitle', 'Reset mouse settings?')"
      :description="
        t(
          'videoEditor.settings.resetMouseSettingsConfirmDesc',
          'This will restore all mouse actions to their default values.',
        )
      "
      :confirm-text="t('videoEditor.settings.resetMouseSettingsConfirmAction', 'Reset')"
      :cancel-text="t('common.cancel', 'Cancel')"
      color="warning"
      icon="i-heroicons-exclamation-triangle"
      @confirm="handleResetDefaults"
    />

    <div class="flex items-center justify-between gap-3 px-1">
      <div class="text-sm font-semibold text-ui-text">
        {{ t('videoEditor.settings.userMouse', 'Mouse') }}
      </div>
      <UButton size="xs" color="neutral" variant="ghost" @click="isResetConfirmOpen = true">
        {{ t('videoEditor.settings.resetDefaults', 'Reset to defaults') }}
      </UButton>
    </div>

    <div class="grid grid-cols-2 gap-4 px-1">
      <div class="flex flex-col gap-1.5">
        <label class="text-xs font-medium text-ui-text-muted">
          {{ t('videoEditor.settings.hotkeysLayer1') }}
        </label>
        <USelectMenu
          :model-value="workspaceStore.userSettings.hotkeys.layer1 ?? 'Shift'"
          :items="LAYER_OPTIONS"
          value-key="value"
          @update:model-value="(val) => updateLayer1(val as LayerKey)"
        />
      </div>
      <div class="flex flex-col gap-1.5">
        <label class="text-xs font-medium text-ui-text-muted">
          {{ t('videoEditor.settings.hotkeysLayer2') }}
        </label>
        <USelectMenu
          :model-value="workspaceStore.userSettings.hotkeys.layer2 ?? 'Control'"
          :items="LAYER_OPTIONS"
          value-key="value"
          @update:model-value="(val) => updateLayer2(val as LayerKey)"
        />
      </div>
    </div>

    <div class="flex flex-col gap-8">
      <SettingsMouseSection
        v-for="section in sectionConfigs"
        :key="section.key"
        :title="section.title"
        :info-title="section.infoTitle"
        :info-items="section.infoItems"
        :info-columns="section.infoColumns"
      >
        <SettingsMouseSelectRow
          v-for="row in section.rows"
          :key="`${section.key}-${row.key}`"
          :label="row.label"
          :model-value="getSettingValue(section.key, row.key)"
          :items="row.options"
          :modified="isModified(section.key, row.key)"
          :default-label="defaultLabel"
          :is-default-value="(value) => isDefault(section.key, row.key, value)"
          @update:model-value="(value) => updateSetting(section.key, row.key, value)"
        />
      </SettingsMouseSection>
    </div>
  </div>
</template>
