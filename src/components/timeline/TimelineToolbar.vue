<script setup lang="ts">
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
      label: t('granVideoEditor.timeline.rippleTrimLeft', 'Ripple trim left'),
      icon: 'i-heroicons-arrow-left',
      onSelect: () => timelineStore.rippleTrimLeft(),
    },
    {
      label: t('granVideoEditor.timeline.rippleTrimRight', 'Ripple trim right'),
      icon: 'i-heroicons-arrow-right',
      onSelect: () => timelineStore.rippleTrimRight(),
    },
  ],
];

function toggleClipSnapMode() {
  settingsStore.setClipSnapMode(settingsStore.clipSnapMode === 'clips' ? 'none' : 'clips');
}
</script>

<template>
  <div
    class="h-7 border-b border-ui-border bg-ui-bg-elevated flex items-center px-1 shrink-0 gap-0.5"
  >
    <UTooltip :text="t('granVideoEditor.timeline.properties.title', 'Timeline properties')">
      <UButton
        size="xs"
        variant="ghost"
        color="neutral"
        icon="i-heroicons-cog-6-tooth"
        @click="timelineStore.selectTimelineProperties()"
      />
    </UTooltip>

    <UTooltip
      :text="
        settingsStore.clipSnapMode === 'clips'
          ? t('granVideoEditor.timeline.clipSnapOn', 'Snap to clips')
          : t('granVideoEditor.timeline.clipSnapOff', 'No clip snapping')
      "
    >
      <UButton
        size="xs"
        :variant="settingsStore.clipSnapMode === 'clips' ? 'solid' : 'ghost'"
        :color="settingsStore.clipSnapMode === 'clips' ? 'primary' : 'neutral'"
        icon="i-heroicons-link"
        @click="toggleClipSnapMode"
      />
    </UTooltip>

    <div class="ml-auto flex items-center gap-0.5">
      <UTooltip :text="t('granVideoEditor.timeline.trim', 'Trim')">
        <UiSplitDropdownButton
          size="xs"
          :variant="timelineStore.isTrimModeActive ? 'solid' : 'ghost'"
          :color="timelineStore.isTrimModeActive ? 'primary' : 'neutral'"
          icon="i-heroicons-scissors"
          :aria-label="undefined"
          :ariaLabel="t('granVideoEditor.timeline.trim', 'Trim')"
          :items="trimMenuItems"
          @click="timelineStore.isTrimModeActive = !timelineStore.isTrimModeActive"
        />
      </UTooltip>

      <!-- Virtual Clips Drag Handles -->
      <UButton
        draggable="true"
        size="xs"
        variant="ghost"
        color="neutral"
        icon="i-heroicons-adjustments-horizontal"
        @dragstart="emit('dragVirtualStart', $event, 'adjustment')"
        @dragend="emit('dragVirtualEnd')"
        @click="timelineStore.addAdjustmentClipAtPlayhead()"
      />
      <UButton
        draggable="true"
        size="xs"
        variant="ghost"
        color="neutral"
        icon="i-heroicons-swatch"
        @dragstart="emit('dragVirtualStart', $event, 'background')"
        @dragend="emit('dragVirtualEnd')"
        @click="timelineStore.addBackgroundClipAtPlayhead()"
      />
      <UButton
        draggable="true"
        size="xs"
        variant="ghost"
        color="neutral"
        icon="i-heroicons-chat-bubble-bottom-center-text"
        @dragstart="emit('dragVirtualStart', $event, 'text')"
        @dragend="emit('dragVirtualEnd')"
        @click="timelineStore.addTextClipAtPlayhead()"
      />
    </div>
  </div>
</template>
