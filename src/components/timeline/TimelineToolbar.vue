<script setup lang="ts">
import UiTooltip from '~/components/ui/UiTooltip.vue';
import type { ToolbarDragMode, ToolbarSnapMode } from '~/stores/timeline-settings.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useTimelineSettingsStore } from '~/stores/timeline-settings.store';
import { useFocusStore } from '~/stores/focus.store';
import { usePresetsStore } from '~/stores/presets.store';
import UiSplitDropdownButton from '~/components/ui/UiSplitDropdownButton.vue';
import UiWheelSlider from '~/components/ui/UiWheelSlider.vue';
import {
  DEFAULT_TIMELINE_ZOOM_POSITION,
  formatZoomMultiplier,
  MAX_TIMELINE_ZOOM_POSITION,
  MIN_TIMELINE_ZOOM_POSITION,
  TIMELINE_ZOOM_POSITIONS,
  timelineZoomPositionToScale,
  timelineZoomScaleToPosition,
} from '~/utils/zoom';
import type { TextClipStyle } from '~/timeline/types';

const { t } = useI18n();
const timelineStore = useTimelineStore();
const settingsStore = useTimelineSettingsStore();
const focusStore = useFocusStore();
const presetsStore = usePresetsStore();

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

const timelineZoom = computed({
  get: () => timelineStore.timelineZoom,
  set: (value: number) => {
    timelineStore.setTimelineZoom(value);
  },
});

const timelineZoomScale = computed(() => timelineZoomPositionToScale(timelineZoom.value));

const timelineZoomMultiplierInput = computed({
  get: () => formatZoomMultiplier(timelineZoomScale.value),
  set: (value: string | number) => {
    const normalized = String(value).trim().toLowerCase().replace(',', '.').replace(/^x/, '');
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    timelineStore.setTimelineZoomExact(timelineZoomScaleToPosition(parsed));
  },
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

const textPresetItems = computed(() => {
  const standard = [
    { id: 'default', label: t('fastcat.library.texts.default', 'Default') },
    { id: 'title', label: t('fastcat.library.texts.title', 'Title') },
    { id: 'subtitle', label: t('fastcat.library.texts.subtitle', 'Subtitle') },
  ];

  const custom = presetsStore.customPresets
    .filter((p) => p.category === 'text')
    .map((p) => ({
      id: p.id,
      label: p.name,
    }));

  return [...standard, ...custom];
});

const standardTextPresets = computed<Record<string, { style: TextClipStyle }>>(() => ({
  default: {
    style: { fontSize: 64, color: '#ffffff', fontFamily: 'sans-serif' },
  },
  title: {
    style: { fontSize: 96, fontWeight: '800', color: '#ffffff', fontFamily: 'sans-serif' },
  },
  subtitle: {
    style: { fontSize: 48, fontWeight: '400', color: '#aaaaaa', fontFamily: 'sans-serif' },
  },
}));

function addTextClip() {
  const presetId = presetsStore.defaultTextPresetId;
  const preset =
    standardTextPresets.value[presetId] ||
    presetsStore.customPresets.find((p) => p.id === presetId)?.params;

  if (preset) {
    timelineStore.addTextClipAtPlayhead({
      style: preset.style,
    });
  } else {
    timelineStore.addTextClipAtPlayhead();
  }
}

function onDragStart(event: DragEvent, type: 'adjustment' | 'background' | 'text') {
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'copy';

    const isRightClick = (event.buttons & 2) !== 0;

    let presetParams = undefined;
    if (type === 'text') {
      const presetId = presetsStore.defaultTextPresetId;
      presetParams =
        standardTextPresets.value[presetId] ||
        presetsStore.customPresets.find((p) => p.id === presetId)?.params;
    }

    // Create a payload compatible with handleLibraryDrop
    const payload = {
      kind: type,
      name: t(
        `fastcat.timeline.${type}ClipDefaultName`,
        type.charAt(0).toUpperCase() + type.slice(1),
      ),
      path: '',
      presetParams,
      isRightClick,
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
      class="h-12 w-full border-b border-ui-border bg-ui-bg-elevated flex items-center px-4 shrink-0"
      data-timeline-toolbar
      @pointerdown.capture="focusStore.setPanelFocus('timeline')"
      @click.self="timelineStore.selectTimelineProperties()"
      @contextmenu="onToolbarContextMenu"
    >
      <!-- Left column: Main actions -->
      <div class="flex-1 flex items-center justify-center gap-1">
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
              @click="
                (e) => {
                  timelineStore.unsoloAllTracks();
                  (e.currentTarget as HTMLElement).blur();
                }
              "
            >
              {{ t('fastcat.timeline.soloActive', 'SOLO ACTIVE') }}
            </UButton>
          </UiTooltip>
        </div>

        <UiTooltip
          :text="`${t('fastcat.timeline.addAdjustment')} (${t('fastcat.timeline.dragToTimeline', 'drag to timeline')})`"
        >
          <div
            draggable="true"
            @dragstart="onDragStart($event, 'adjustment')"
            @dragend="onDragEnd"
          >
            <UButton
              size="xs"
              variant="ghost"
              color="neutral"
              icon="i-heroicons-adjustments-horizontal"
              class="hover:bg-ui-bg-hover/60"
              @click="
                (e) => {
                  timelineStore.addAdjustmentClipAtPlayhead();
                  (e.currentTarget as HTMLElement).blur();
                }
              "
            />
          </div>
        </UiTooltip>

        <UiTooltip
          :text="`${t('fastcat.timeline.addBackground')} (${t('fastcat.timeline.dragToTimeline', 'drag to timeline')})`"
        >
          <div
            draggable="true"
            @dragstart="onDragStart($event, 'background')"
            @dragend="onDragEnd"
          >
            <UButton
              size="xs"
              variant="ghost"
              color="neutral"
              icon="i-heroicons-swatch"
              class="hover:bg-ui-bg-hover/60"
              @click="
                (e) => {
                  timelineStore.addBackgroundClipAtPlayhead();
                  (e.currentTarget as HTMLElement).blur();
                }
              "
            />
          </div>
        </UiTooltip>

        <UiTooltip
          :text="`${t('fastcat.timeline.addText')} (${t('fastcat.timeline.dragToTimeline', 'drag to timeline')})`"
        >
          <div
            draggable="true"
            @dragstart="onDragStart($event, 'text')"
            @dragend="onDragEnd"
            @contextmenu.prevent="() => {}"
          >
            <UButton
              size="xs"
              variant="ghost"
              color="neutral"
              icon="i-heroicons-chat-bubble-bottom-center-text"
              class="hover:bg-ui-bg-hover/60"
              @click="
                (e) => {
                  addTextClip();
                  (e.currentTarget as HTMLElement).blur();
                }
              "
            />
          </div>
        </UiTooltip>

        <!-- Separator -->
        <div class="w-px h-4 bg-ui-border mx-2 opacity-50" />

        <!-- Marker controls -->
        <div class="flex items-center gap-1">
          <UiTooltip :text="t('fastcat.timeline.previousMarker', 'Previous marker')">
            <UButton
              size="xs"
              variant="ghost"
              color="neutral"
              icon="i-heroicons-chevron-left"
              class="hover:bg-ui-bg-hover/60"
              @click="timelineStore.goToPreviousMarker()"
            />
          </UiTooltip>

          <UiTooltip :text="t('fastcat.timeline.addMarker', 'Add marker')">
            <UButton
              size="xs"
              variant="ghost"
              color="neutral"
              icon="i-heroicons-bookmark"
              class="hover:bg-ui-bg-hover/60"
              @click="timelineStore.addMarkerAtPlayhead()"
            />
          </UiTooltip>

          <UiTooltip :text="t('fastcat.timeline.nextMarker', 'Next marker')">
            <UButton
              size="xs"
              variant="ghost"
              color="neutral"
              icon="i-heroicons-chevron-right"
              class="hover:bg-ui-bg-hover/60"
              @click="timelineStore.goToNextMarker()"
            />
          </UiTooltip>
        </div>
      </div>

      <!-- Right column: Zoom controls -->
      <div class="w-[280px] flex items-center gap-2 pl-4 border-l border-ui-border/30">
        <UiTooltip :text="t('fastcat.timeline.zoomToFit', 'Fit to zoom')">
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-heroicons-arrows-pointing-out"
            class="hover:bg-ui-bg-hover/60"
            @click="timelineStore.fitTimelineZoom()"
          />
        </UiTooltip>

        <div class="flex-1 min-w-0">
          <UiWheelSlider
            v-model="timelineZoom"
            :min="MIN_TIMELINE_ZOOM_POSITION"
            :max="MAX_TIMELINE_ZOOM_POSITION"
            :step="0.01"
            :steps="TIMELINE_ZOOM_POSITIONS"
            :default-value="DEFAULT_TIMELINE_ZOOM_POSITION"
          />
        </div>

        <div class="w-16 shrink-0">
          <UInput
            v-model="timelineZoomMultiplierInput"
            size="xs"
            class="w-full font-mono text-center"
            variant="none"
          />
        </div>
      </div>
    </div>
  </UContextMenu>
</template>
