<script setup lang="ts">
import UiTooltip from '~/components/ui/UiTooltip.vue';
import type { ToolbarDragMode, ToolbarSnapMode } from '~/stores/timeline-settings.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useTimelineSettingsStore } from '~/stores/timeline-settings.store';
import { useFocusStore } from '~/stores/focus.store';
import UiSplitDropdownButton from '~/components/ui/UiSplitDropdownButton.vue';

const { t } = useI18n();
const timelineStore = useTimelineStore();
const settingsStore = useTimelineSettingsStore();
const focusStore = useFocusStore();

const emit = defineEmits<{
  (e: 'dragVirtualStart', event: DragEvent, type: 'adjustment' | 'background' | 'text'): void;
  (e: 'dragVirtualEnd'): void;
}>();

const trimMenuItems = computed(() => {
  const isNoClipSelected = timelineStore.getHotkeyTargetClip() === null;

  return [
    [
      {
        label: t('fastcat.timeline.rippleTrimLeft', 'Ripple trim left'),
        icon: 'i-heroicons-arrow-left',
        disabled: isNoClipSelected,
        onSelect: () => timelineStore.rippleTrimLeft(),
      },
      {
        label: t('fastcat.timeline.rippleTrimRight', 'Ripple trim right'),
        icon: 'i-heroicons-arrow-right',
        disabled: isNoClipSelected,
        onSelect: () => timelineStore.rippleTrimRight(),
      },
    ],
  ];
});

const snapModeItems = computed(() => [
  [
    {
      label: t('fastcat.timeline.clipSnapOn', 'Snap'),
      icon: settingsStore.toolbarSnapMode === 'snap' ? 'i-heroicons-check' : 'i-heroicons-none',
      onSelect: () => selectToolbarSnapMode('snap'),
    },
    {
      label: t('fastcat.timeline.clipSnapOffFrames', 'No snap'),
      icon: settingsStore.toolbarSnapMode === 'no_snap' ? 'i-heroicons-check' : 'i-heroicons-none',
      onSelect: () => selectToolbarSnapMode('no_snap'),
    },
    {
      label: t('videoEditor.settings.actionFreeMode', 'Free mode'),
      icon:
        settingsStore.toolbarSnapMode === 'free_mode' ? 'i-heroicons-check' : 'i-heroicons-none',
      onSelect: () => selectToolbarSnapMode('free_mode'),
    },
  ],
]);

const dragModeItems = computed(() => [
  [
    {
      label: t('videoEditor.settings.actionPseudoOverlap', 'Pseudo overlap'),
      icon:
        settingsStore.toolbarDragMode === 'pseudo_overlap'
          ? 'i-heroicons-check'
          : 'i-heroicons-none',
      onSelect: () => selectToolbarDragMode('pseudo_overlap'),
    },
    {
      label: t('fastcat.timeline.slipMode', 'Slip content'),
      icon: settingsStore.toolbarDragMode === 'slip' ? 'i-heroicons-check' : 'i-heroicons-none',
      onSelect: () => selectToolbarDragMode('slip'),
    },
    {
      label: t('videoEditor.settings.actionCopy', 'Copy clip'),
      icon: settingsStore.toolbarDragMode === 'copy' ? 'i-heroicons-check' : 'i-heroicons-none',
      onSelect: () => selectToolbarDragMode('copy'),
    },
  ],
]);

const toolbarSnapModeIcon = computed(() => {
  if (settingsStore.toolbarSnapMode === 'free_mode') {
    return 'i-heroicons-arrows-pointing-out';
  }

  if (settingsStore.toolbarSnapMode === 'no_snap') {
    return 'i-heroicons-link-slash';
  }

  return 'i-heroicons-link';
});

const toolbarDragModeIcon = computed(() => {
  if (settingsStore.toolbarDragMode === 'pseudo_overlap') {
    return 'i-heroicons-rectangle-stack';
  }

  if (settingsStore.toolbarDragMode === 'copy') {
    return 'i-heroicons-document-duplicate';
  }

  if (settingsStore.toolbarDragMode === 'slip') {
    return 'i-heroicons-arrows-right-left';
  }

  return 'i-heroicons-rectangle-stack';
});

const toolbarDragModeVariant = computed(() => {
  return settingsStore.toolbarDragModeEnabled ? 'solid' : 'ghost';
});

function selectToolbarSnapMode(mode: ToolbarSnapMode) {
  settingsStore.selectToolbarSnapMode(mode);
}

function cycleToolbarSnapMode() {
  settingsStore.cycleToolbarSnapMode();
}

function selectToolbarDragMode(mode: ToolbarDragMode) {
  settingsStore.selectToolbarDragMode(mode);
}

function toggleToolbarDragMode() {
  settingsStore.toggleSelectedToolbarDragMode();
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

const toolbarEmptyAreaContextMenuItems = [
  [
    {
      label: t('fastcat.timeline.properties.title'),
      icon: 'i-heroicons-cog-6-tooth',
      onSelect: () => timelineStore.selectTimelineProperties(),
    },
  ],
];

function onToolbarContextMenu(e: MouseEvent) {
  e.stopPropagation();
}
</script>

<template>
  <UContextMenu :items="toolbarEmptyAreaContextMenuItems">
    <div
      class="h-8 border-b border-ui-border bg-ui-bg-elevated flex items-center px-1 shrink-0 gap-0.5"
      data-timeline-toolbar
      @pointerdown.capture="focusStore.setPanelFocus('timeline')"
      @click.self="timelineStore.selectTimelineProperties()"
      @contextmenu="onToolbarContextMenu"
    >
      <UiTooltip :text="t('fastcat.timeline.snapMode', 'Snap Mode')">
        <UiSplitDropdownButton
          size="xs"
          variant="ghost"
          color="neutral"
          :icon="toolbarSnapModeIcon"
          :ariaLabel="t('fastcat.timeline.snapMode', 'Snap Mode')"
          :items="snapModeItems"
          button-class="hover:bg-ui-bg-hover/60"
          caret-button-class="px-0.5 hover:bg-ui-bg-hover/60"
          caret-icon-class="size-2.5"
          @click="cycleToolbarSnapMode"
        />
      </UiTooltip>

      <UiTooltip :text="t('fastcat.timeline.moveMode', 'Clip Move Mode')">
        <UiSplitDropdownButton
          size="xs"
          :variant="toolbarDragModeVariant"
          :color="settingsStore.toolbarDragModeEnabled ? 'primary' : 'neutral'"
          :icon="toolbarDragModeIcon"
          :ariaLabel="t('fastcat.timeline.moveMode', 'Clip Move Mode')"
          :items="dragModeItems"
          button-class="hover:bg-ui-bg-hover/60"
          caret-button-class="px-0.5 hover:bg-ui-bg-hover/60"
          caret-icon-class="size-2.5"
          @click="toggleToolbarDragMode"
        />
      </UiTooltip>

      <UiTooltip :text="t('fastcat.timeline.trim', 'Trim')">
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
      </UiTooltip>

      <div v-if="timelineStore.isAnyTrackSoloed" class="ml-2 flex items-center">
        <UiTooltip :text="t('fastcat.timeline.clearSolos', 'Clear all solos')">
          <UButton
            size="xs"
            color="amber"
            variant="solid"
            icon="i-heroicons-musical-note"
            class="h-6 text-2xs px-2 gap-1 font-bold animate-pulse hover:animate-none"
            @click="(e) => {
              timelineStore.unsoloAllTracks();
              (e.currentTarget as HTMLElement).blur();
            }"
          >
            {{ t('fastcat.timeline.soloActive', 'SOLO ACTIVE') }}
          </UButton>
        </UiTooltip>
      </div>

      <div
        class="ml-auto flex items-center gap-0.5"
        @click.self="timelineStore.selectTimelineProperties()"
      >
        <UiTooltip
          :text="`${t('fastcat.timeline.addAdjustment')} (${t('fastcat.timeline.dragToTimeline', 'drag to timeline')})`"
        >
          <UButton
            draggable="true"
            size="xs"
            variant="ghost"
            color="neutral"
            icon="i-heroicons-adjustments-horizontal"
            class="hover:bg-ui-bg"
            @dragstart="onDragStart($event, 'adjustment')"
            @dragend="onDragEnd"
            @click="(e) => {
              timelineStore.addAdjustmentClipAtPlayhead();
              (e.currentTarget as HTMLElement).blur();
            }"
          />
        </UiTooltip>
        <UiTooltip
          :text="`${t('fastcat.timeline.addBackground')} (${t('fastcat.timeline.dragToTimeline', 'drag to timeline')})`"
        >
          <UButton
            draggable="true"
            size="xs"
            variant="ghost"
            color="neutral"
            icon="i-heroicons-swatch"
            class="hover:bg-ui-bg"
            @dragstart="onDragStart($event, 'background')"
            @dragend="onDragEnd"
            @click="(e) => {
              timelineStore.addBackgroundClipAtPlayhead();
              (e.currentTarget as HTMLElement).blur();
            }"
          />
        </UiTooltip>
        <UiTooltip
          :text="`${t('fastcat.timeline.addText')} (${t('fastcat.timeline.dragToTimeline', 'drag to timeline')})`"
        >
          <UButton
            draggable="true"
            size="xs"
            variant="ghost"
            color="neutral"
            icon="i-heroicons-chat-bubble-bottom-center-text"
            class="hover:bg-ui-bg"
            @dragstart="onDragStart($event, 'text')"
            @dragend="onDragEnd"
            @click="(e) => {
              timelineStore.addTextClipAtPlayhead();
              (e.currentTarget as HTMLElement).blur();
            }"
          />
        </UiTooltip>
      </div>
    </div>
  </UContextMenu>
</template>
