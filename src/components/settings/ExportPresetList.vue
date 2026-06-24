<script setup lang="ts">
import { computed } from 'vue';
import UiActionButton from '~/components/ui/UiActionButton.vue';
import {
  type ExportSettingsPreset,
  getExportPresetSummary,
  isBuiltInExportPreset,
} from '~/utils/settings';

interface Props {
  presets: ExportSettingsPreset[];
  selectedId: string;
  disabled?: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  select: [id: string];
  duplicate: [id: string];
  delete: [id: string];
  create: [];
}>();

const { t } = useI18n();

const presetItems = computed(() =>
  props.presets.map((preset) => ({
    preset,
    summary: getExportPresetSummary(preset),
    isBuiltIn: isBuiltInExportPreset(preset),
    isSelected: preset.id === props.selectedId,
  })),
);

function selectPreset(id: string) {
  if (props.disabled) return;
  emit('select', id);
}

function duplicatePreset(event: MouseEvent, id: string) {
  event.stopPropagation();
  emit('duplicate', id);
}

function deletePreset(event: MouseEvent, id: string) {
  event.stopPropagation();
  emit('delete', id);
}

function createPreset() {
  emit('create');
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center justify-between gap-3">
      <h3 class="text-sm font-medium text-ui-text">
        {{ t('videoEditor.settings.presetListTitle') }}
      </h3>
      <UButton
        size="xs"
        color="neutral"
        variant="ghost"
        icon="i-heroicons-plus"
        :disabled="props.disabled"
        @click="createPreset"
      >
        {{ t('common.add') }}
      </UButton>
    </div>

    <div v-if="presetItems.length > 0" class="flex flex-col gap-1">
      <button
        v-for="item in presetItems"
        :key="item.preset.id"
        type="button"
        class="group flex items-center justify-between gap-3 rounded-lg border border-transparent px-3 py-2 text-left transition-colors"
        :class="{
          'bg-ui-bg-elevated border-ui-border': item.isSelected,
          'hover:bg-ui-bg-elevated/50': !item.isSelected,
          'opacity-50 pointer-events-none': props.disabled,
        }"
        @click="selectPreset(item.preset.id)"
      >
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <div class="flex items-center gap-2">
            <span class="truncate text-sm font-medium text-ui-text">{{ item.preset.name }}</span>
            <UBadge
              v-if="item.isBuiltIn"
              size="xs"
              color="neutral"
              variant="subtle"
              class="shrink-0"
            >
              {{ t('videoEditor.settings.presetBuiltIn') }}
            </UBadge>
          </div>
          <span class="truncate text-xs text-ui-text-muted">{{ item.summary }}</span>
        </div>

        <div class="flex shrink-0 items-center gap-1 opacity-80 group-hover:opacity-100">
          <UiActionButton
            size="xs"
            square
            icon="i-heroicons-document-duplicate"
            :title="t('common.duplicate')"
            :disabled="props.disabled"
            @click="(event: MouseEvent) => duplicatePreset(event, item.preset.id)"
          />
          <UiActionButton
            v-if="!item.isBuiltIn"
            size="xs"
            square
            color="error"
            icon="i-heroicons-trash"
            :title="t('common.delete')"
            :disabled="props.disabled"
            @click="(event: MouseEvent) => deletePreset(event, item.preset.id)"
          />
        </div>
      </button>
    </div>

    <UiEmptyState
      v-else
      :message="t('videoEditor.settings.noPresets')"
      icon="i-heroicons-adjustments-horizontal"
      wrapper-class="rounded-lg border border-dashed border-ui-border py-6"
    />
  </div>
</template>
