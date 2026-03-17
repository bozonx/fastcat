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

function toggleClipSnapMode() {
  settingsStore.setClipSnapMode(settingsStore.clipSnapMode === 'clips' ? 'none' : 'clips');
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
    @click.self="timelineStore.selectTimelineProperties()"
  >

    <UTooltip
      :text="
        settingsStore.clipSnapMode === 'clips'
          ? t('fastcat.timeline.clipSnapOn', 'Snap to clips')
          : t('fastcat.timeline.clipSnapOff', 'No clip snapping')
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
      <UTooltip :text="t('fastcat.timeline.trim', 'Trim')">
        <UiSplitDropdownButton
          size="xs"
          :variant="timelineStore.isTrimModeActive ? 'solid' : 'ghost'"
          :color="timelineStore.isTrimModeActive ? 'primary' : 'neutral'"
          icon="i-heroicons-scissors"
          :ariaLabel="t('fastcat.timeline.trim', 'Trim')"
          :items="trimMenuItems"
          @click="timelineStore.isTrimModeActive = !timelineStore.isTrimModeActive"
        />
      </UTooltip>

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
