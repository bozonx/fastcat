<script setup lang="ts">
import { computed, inject } from 'vue';
import { useFileManagerStore, type FileSortField } from '~/stores/file-manager.store';
import UiWheelSlider from '~/components/ui/UiWheelSlider.vue';
import UiToggleButton from '~/components/ui/UiToggleButton.vue';
import UiActionButton from '~/components/ui/UiActionButton.vue';
import UiTooltip from '~/components/ui/UiTooltip.vue';
import { useHotkeyLabel } from '~/composables/useHotkeyLabel';

const props = defineProps<{
  gridSizes: number[];
  currentGridSizeName: string;
  gridCardSize: number;
  remoteAvailable?: boolean;
  isRemotePanel?: boolean;
  compact?: boolean;
  hideActions?: boolean;
  hideUpload?: boolean;
  hideViewSwitcher?: boolean;
  hideSelectUnused?: boolean;
}>();

const emit = defineEmits<{
  (e: 'refresh'): void;
  (e: 'openRemote'): void;
  (e: 'closeRemote'): void;
  (e: 'createFolder'): void;
  (e: 'upload'): void;
  (e: 'selectAll'): void;
  (e: 'selectUnused'): void;
  (e: 'invertSelection'): void;
}>();

const { t } = useI18n();
const { getHotkeyLabel, getHotkeyKbds, getHotkeyTitle } = useHotkeyLabel();
const fileManagerStore =
  (inject('fileManagerStore', null) as ReturnType<typeof useFileManagerStore> | null) ||
  useFileManagerStore();

const sortFields: { label: string; value: FileSortField }[] = [
  { label: t('common.name'), value: 'name' },
  { label: t('common.type'), value: 'type' },
  { label: t('common.size'), value: 'size' },
  { label: t('common.created'), value: 'created' },
  { label: t('common.modified'), value: 'modified' },
];

const gridScaleTooltip = computed(() => {
  const zoomInLabel = getHotkeyLabel('general.zoomIn');
  const zoomOutLabel = getHotkeyLabel('general.zoomOut');
  const zoomResetLabel = getHotkeyLabel('general.zoomReset');

  const parts = [`${t('videoEditor.fileManager.cardScale')}: ${props.currentGridSizeName}`];

  if (zoomInLabel) {
    parts.push(`${t('videoEditor.hotkeys.general.zoomIn', 'Zoom in')} (${zoomInLabel})`);
  }
  if (zoomOutLabel) {
    parts.push(`${t('videoEditor.hotkeys.general.zoomOut', 'Zoom out')} (${zoomOutLabel})`);
  }
  if (zoomResetLabel) {
    parts.push(`${t('videoEditor.hotkeys.general.zoomReset', 'Reset zoom')} (${zoomResetLabel})`);
  }

  return parts.join(' | ');
});

const toolbarMenuItems = computed(() => {
  const items = [];

  // 1. Actions group
  const actions = [
    {
      label: t('common.refresh'),
      icon: 'i-heroicons-arrow-path',
      onSelect: () => emit('refresh'),
    },
  ];

  if (!props.isRemotePanel) {
    actions.push({
      label: fileManagerStore.showHiddenFiles
        ? t('videoEditor.fileManager.actions.hideHiddenFiles')
        : t('videoEditor.fileManager.actions.showHiddenFiles'),
      icon: fileManagerStore.showHiddenFiles ? 'i-heroicons-eye-slash' : 'i-heroicons-eye',
      onSelect: () => {
        fileManagerStore.setShowHiddenFiles(!fileManagerStore.showHiddenFiles);
      },
    });
  }

  items.push(actions);

  if (!props.isRemotePanel) {
    const selectionItems = [
      {
        label: t('common.selectAll'),
        icon: 'i-heroicons-check-circle',
        kbds: getHotkeyKbds('general.selectAll'),
        onSelect: () => emit('selectAll'),
      },
      {
        label: t('common.invertSelection'),
        icon: 'i-heroicons-arrow-path-rounded-square',
        onSelect: () => emit('invertSelection'),
      },
    ];
    if (!props.hideSelectUnused) {
      selectionItems.splice(1, 0, {
        label: t('common.selectUnused'),
        icon: 'i-heroicons-circle-stack',
        onSelect: () => emit('selectUnused'),
      });
    }
    items.push(selectionItems);
  }

  // 2. Sort Fields Section
  const allowedFields = props.isRemotePanel
    ? ['name', 'created']
    : ['name', 'type', 'size', 'created', 'modified'];

  const filteredSortFields = sortFields.filter((f) => allowedFields.includes(f.value));

  const sortSection = filteredSortFields.map((field) => ({
    label: field.label,
    icon: fileManagerStore.sortOption.field === field.value ? 'i-heroicons-check' : undefined,
    onSelect: () => {
      fileManagerStore.sortOption.field = field.value;
      emit('refresh');
    },
  }));

  if (sortSection.length > 0) {
    items.push(sortSection);

    // 3. Sort Order Section
    items.push([
      {
        label: t('common.sortOrder.asc'),
        icon: fileManagerStore.sortOption.order === 'asc' ? 'i-heroicons-check' : undefined,
        onSelect: () => {
          fileManagerStore.sortOption.order = 'asc';
          emit('refresh');
        },
      },
      {
        label: t('common.sortOrder.desc'),
        icon: fileManagerStore.sortOption.order === 'desc' ? 'i-heroicons-check' : undefined,
        onSelect: () => {
          fileManagerStore.sortOption.order = 'desc';
          emit('refresh');
        },
      },
    ]);
  }

  return items;
});
</script>

<template>
  <div
    class="flex items-center gap-4 px-4 py-2 border-b border-ui-border shrink-0 bg-ui-bg-elevated/50"
  >
    <div v-if="!isRemotePanel && !hideViewSwitcher" class="flex items-center gap-1">
      <UiToggleButton
        :model-value="fileManagerStore.viewMode === 'grid'"
        icon="i-heroicons-squares-2x2"
        inactive-color="neutral"
        active-color="primary"
        size="sm"
        title="Grid view"
        no-toggle
        @click="fileManagerStore.setViewMode('grid')"
      />
      <UiToggleButton
        :model-value="fileManagerStore.viewMode === 'list'"
        icon="i-heroicons-list-bullet"
        inactive-color="neutral"
        active-color="primary"
        size="sm"
        title="List view"
        no-toggle
        @click="fileManagerStore.setViewMode('list')"
      />
    </div>

    <div v-if="!isRemotePanel && !hideActions" class="flex items-center gap-1">
      <div v-if="!hideViewSwitcher" class="w-px h-4 bg-ui-border mx-2"></div>

      <UiActionButton
        icon="i-heroicons-folder-plus"
        variant="ghost"
        color="neutral"
        size="sm"
        :title="getHotkeyTitle(t('videoEditor.fileManager.actions.createFolder'), 'general.createFolder')"
        @click="emit('createFolder')"
      />
    </div>

    <UiTooltip
      v-if="props.isRemotePanel || fileManagerStore.viewMode === 'grid'"
      :text="gridScaleTooltip"
      class="flex items-center gap-2 ml-2 w-full max-w-24"
    >
      <UiWheelSlider
        :model-value="gridSizes.indexOf(props.gridCardSize)"
        :min="0"
        :max="gridSizes.length - 1"
        :step="1"
        wheel-without-focus
        class="flex-1 w-full"
        @update:model-value="
          (v: number) => {
            const size = gridSizes[v] || 80;
            fileManagerStore.setGridCardSize(size);
          }
        "
      />
    </UiTooltip>

    <div class="ml-auto flex items-center gap-2">
      <div v-if="toolbarMenuItems.length > 0" class="w-px h-4 bg-ui-border mx-1"></div>

      <UDropdownMenu
        v-if="toolbarMenuItems.length > 0"
        :items="toolbarMenuItems"
        :ui="{ content: 'w-56' }"
      >
        <UiActionButton
          icon="i-heroicons-ellipsis-horizontal"
          variant="ghost"
          color="neutral"
          size="xs"
        />
      </UDropdownMenu>
    </div>
  </div>
</template>
