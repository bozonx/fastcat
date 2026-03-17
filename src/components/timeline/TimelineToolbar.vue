<script setup lang="ts">
import type { ToolbarMoveMode } from '~/stores/timelineSettings.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useTimelineSettingsStore } from '~/stores/timelineSettings.store';
import UiSplitDropdownButton from '~/components/ui/UiSplitDropdownButton.vue';

const { t } = useI18n();
const timelineStore = useTimelineStore();
const settingsStore = useTimelineSettingsStore();

const emit = defineEmits<{
  (e: 'dragVirtualStart', event: DragEvent, type: 'adjustment' | 'background' | 'text'): void;
  (e: 'dragVirtualEnd'): void;
}>();

const trimMenuItems = [
  [
    {
      label: t('fastcat.timeline.rippleTrimLeft', 'Ripple trim left'),
      icon: 'i-heroicons-arrow-left',
      onSelect: () => timelineStore.rippleTrimLeft(),
    },
    {
      label: t('fastcat.timeline.rippleTrimRight', 'Ripple trim right'),
      icon: 'i-heroicons-arrow-right',
      onSelect: () => timelineStore.rippleTrimRight(),
    },
  ],
];

const moveModeItems = computed(() => [
  [
    {
      label: t('fastcat.timeline.clipSnapOn', 'Snap'),
      icon: settingsStore.toolbarMoveMode === 'snap' ? 'i-heroicons-check' : 'i-heroicons-none',
      onSelect: () => selectToolbarMoveMode('snap'),
    },
    {
      label: t('videoEditor.settings.actionFreeMode', 'Free mode'),
      icon: settingsStore.toolbarMoveMode === 'free_mode' ? 'i-heroicons-check' : 'i-heroicons-none',
      onSelect: () => selectToolbarMoveMode('free_mode'),
    },
    {
      label: t('videoEditor.settings.actionPseudoOverlap', 'Pseudo overlap'),
      icon: settingsStore.toolbarMoveMode === 'pseudo_overlap' ? 'i-heroicons-check' : 'i-heroicons-none',
      onSelect: () => selectToolbarMoveMode('pseudo_overlap'),
    },
    {
      label: t('videoEditor.settings.actionCopy', 'Copy clip'),
      icon: settingsStore.toolbarMoveMode === 'copy' ? 'i-heroicons-check' : 'i-heroicons-none',
      onSelect: () => selectToolbarMoveMode('copy'),
    },
    {
      label: t('fastcat.timeline.slipMode', 'Slip content'),
      icon: settingsStore.toolbarMoveMode === 'slip' ? 'i-heroicons-check' : 'i-heroicons-none',
      onSelect: () => selectToolbarMoveMode('slip'),
    },
  ],
]);

const isToolbarMoveModeActive = computed(() => {
  return settingsStore.toolbarMoveModeEnabled;
});

const toolbarMoveModeIcon = computed(() => {
  if (settingsStore.toolbarMoveMode === 'free_mode') {
    return 'i-heroicons-arrows-pointing-out';
  }

  if (settingsStore.toolbarMoveMode === 'pseudo_overlap') {
    return 'i-heroicons-rectangle-stack';
  }

  if (settingsStore.toolbarMoveMode === 'copy') {
    return 'i-heroicons-document-duplicate';
  }

  if (settingsStore.toolbarMoveMode === 'slip') {
    return 'i-heroicons-arrows-right-left';
  }

  return 'i-heroicons-link';
});

const toolbarMoveModeVariant = computed(() => {
  return isToolbarMoveModeActive.value ? 'solid' : 'ghost';
});

function selectToolbarMoveMode(mode: ToolbarMoveMode) {
  settingsStore.selectToolbarMoveMode(mode);
}

function toggleToolbarMoveMode() {
  settingsStore.toggleSelectedToolbarMoveMode();
}

function toggleTrimMode(event?: MouseEvent) {
  event?.preventDefault();
  event?.stopPropagation();
  timelineStore.isTrimModeActive = !timelineStore.isTrimModeActive;
}

function onDragStart(event: DragEvent, type: 'adjustment' | 'background' | 'text') {
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'copy';

    // Create a payload compatible with handleLibraryDrop
    const payload = {
      kind: type,
      name: t(
        `fastcat.timeline.${type}ClipDefaultName`,
        type.charAt(0).toUpperCase() + type.slice(1),
      ),
      path: '',
    };

    const json = JSON.stringify(payload);
    event.dataTransfer.setData('application/json', json);
    event.dataTransfer.setData('application/fastcat-virtual-clip', type);
  }
  emit('dragVirtualStart', event, type);
}

function onDragEnd() {
  emit('dragVirtualEnd');
}
</script>

<template>
  <div
    class="h-7 border-b border-ui-border bg-ui-bg-elevated flex items-center px-1 shrink-0 gap-0.5"
    data-timeline-toolbar
    @click.self="timelineStore.selectTimelineProperties()"
  >

    <UTooltip :text="t('fastcat.timeline.moveMode', 'Clip Move Mode')">
      <UiSplitDropdownButton
        size="xs"
        :variant="toolbarMoveModeVariant"
        :color="isToolbarMoveModeActive ? 'primary' : 'neutral'"
        :icon="toolbarMoveModeIcon"
        :ariaLabel="t('fastcat.timeline.moveMode', 'Clip Move Mode')"
        :items="moveModeItems"
        button-class="hover:bg-ui-bg-hover/60"
        caret-button-class="px-0.5 hover:bg-ui-bg-hover/60"
        caret-icon-class="size-2.5"
        @click="toggleToolbarMoveMode"
      />
    </UTooltip>

    <UTooltip :text="t('fastcat.timeline.trim', 'Trim')">
      <UiSplitDropdownButton
        size="xs"
        :variant="timelineStore.isTrimModeActive ? 'solid' : 'ghost'"
        :color="timelineStore.isTrimModeActive ? 'primary' : 'neutral'"
        icon="i-heroicons-scissors"
        :ariaLabel="t('fastcat.timeline.trim', 'Trim')"
        :items="trimMenuItems"
        button-class="hover:bg-ui-bg-hover/60"
        caret-button-class="px-0.5 hover:bg-ui-bg-hover/60"
        caret-icon-class="size-2.5"
        @click="toggleTrimMode"
      />
    </UTooltip>

    <div v-if="timelineStore.isAnyTrackSoloed" class="ml-2 flex items-center">
      <UTooltip :text="t('fastcat.timeline.clearSolos', 'Clear all solos')">
        <UButton
          size="xs"
          color="amber"
          variant="solid"
          icon="i-heroicons-musical-note"
          class="h-6 text-[10px] px-2 gap-1 font-bold animate-pulse hover:animate-none"
          @click="timelineStore.unsoloAllTracks"
        >
          {{ t('fastcat.timeline.soloActive', 'SOLO ACTIVE') }}
        </UButton>
      </UTooltip>
    </div>

    <div class="ml-auto flex items-center gap-0.5" @click.self="timelineStore.selectTimelineProperties()">
      <!-- Virtual Clips Drag Handles -->
      <UTooltip :text="`${t('fastcat.timeline.addAdjustment')} (${t('fastcat.timeline.dragToTimeline', 'drag to timeline')})`">
        <UButton
          draggable="true"
          size="xs"
          variant="ghost"
          color="neutral"
          icon="i-heroicons-adjustments-horizontal"
          class="hover:bg-ui-bg"
          @dragstart="onDragStart($event, 'adjustment')"
          @dragend="onDragEnd"
          @click="timelineStore.addAdjustmentClipAtPlayhead()"
        />
      </UTooltip>
      <UTooltip :text="`${t('fastcat.timeline.addBackground')} (${t('fastcat.timeline.dragToTimeline', 'drag to timeline')})`">
        <UButton
          draggable="true"
          size="xs"
          variant="ghost"
          color="neutral"
          icon="i-heroicons-swatch"
          class="hover:bg-ui-bg"
          @dragstart="onDragStart($event, 'background')"
          @dragend="onDragEnd"
          @click="timelineStore.addBackgroundClipAtPlayhead()"
        />
      </UTooltip>
      <UTooltip :text="`${t('fastcat.timeline.addText')} (${t('fastcat.timeline.dragToTimeline', 'drag to timeline')})`">
        <UButton
          draggable="true"
          size="xs"
          variant="ghost"
          color="neutral"
          icon="i-heroicons-chat-bubble-bottom-center-text"
          class="hover:bg-ui-bg"
          @dragstart="onDragStart($event, 'text')"
          @dragend="onDragEnd"
          @click="timelineStore.addTextClipAtPlayhead()"
        />
      </UTooltip>
    </div>
  </div>
</template>
