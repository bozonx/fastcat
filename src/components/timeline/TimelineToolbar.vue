<script setup lang="ts">
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import UiTooltip from '~/components/ui/UiTooltip.vue';
import type { ToolbarDragMode, ToolbarSnapMode } from '~/stores/timeline-settings.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useTimelineSettingsStore } from '~/stores/timeline-settings.store';
import { useFocusStore } from '~/stores/focus.store';
import { usePresetsStore } from '~/stores/presets.store';
import { useProjectTabsStore } from '~/stores/project-tabs.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import UiSplitDropdownButton from '~/components/ui/UiSplitDropdownButton.vue';
import UiWheelSlider from '~/components/ui/UiWheelSlider.vue';
import {
  DEFAULT_TIMELINE_ZOOM_POSITION,
  formatZoomPercent,
  MAX_TIMELINE_ZOOM_POSITION,
  MIN_TIMELINE_ZOOM_POSITION,
  timelineZoomPositionToScale,
  timelineZoomScaleToPosition,
} from '~/utils/zoom';
import { LAYER_OPTIONS } from '~/utils/hotkeys/layerUtils';
import type { TextClipStyle } from '~/timeline/types';
import { useTimelineTextPreset } from '~/composables/timeline/useTimelineTextPreset';
import { useUiStore } from '~/stores/ui.store';
import TimelineSnapSettingsModal from './TimelineSnapSettingsModal.vue';

import { useTimelineEmptyAreaContextMenu } from '~/composables/timeline/useTimelineEmptyAreaContextMenu';

const { t } = useI18n();
const timelineStore = useTimelineStore();
const settingsStore = useTimelineSettingsStore();
const focusStore = useFocusStore();
const presetsStore = usePresetsStore();
const projectTabsStore = useProjectTabsStore();

const uiStore = useUiStore();
const workspaceStore = useWorkspaceStore();

const layer1Label = computed(() => {
  const key = workspaceStore.userSettings.hotkeys.layer1 || 'Shift';
  return (
    LAYER_OPTIONS.find((o) => o.value === key)?.label ||
    (key === 'Shift' ? 'Shift (Any)' : key)
  );
});
const { isSnapSettingsModalOpen } = storeToRefs(settingsStore);
const { showPresetModal } = useTimelineTextPreset();

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

const moveModeOptions = computed<
  { value: 'none' | ToolbarDragMode; icon: string; tooltip: string }[]
>(() => [
  {
    value: 'none',
    icon: 'i-heroicons-cursor-arrow-rays',
    tooltip: t('fastcat.timeline.moveModeNormalDescription'),
  },
  {
    value: 'pseudo_overlap',
    icon: 'i-heroicons-rectangle-stack',
    tooltip: t('fastcat.timeline.moveModePseudoDescription'),
  },
  {
    value: 'slip',
    icon: 'i-heroicons-arrows-right-left',
    tooltip: t('fastcat.timeline.moveModeSlipDescription'),
  },
]);

const currentMoveMode = computed({
  get: () => {
    if (!settingsStore.toolbarDragModeEnabled) return 'none';
    return settingsStore.toolbarDragMode;
  },
  set: (val: 'none' | ToolbarDragMode) => {
    if (val === 'none') {
      settingsStore.toolbarDragModeEnabled = false;
    } else {
      settingsStore.selectToolbarDragMode(val);
    }
  },
});

const timelineZoom = computed({
  get: () => timelineStore.timelineZoom,
  set: (value: number) => {
    timelineStore.setTimelineZoom(value);
  },
});

const timelineZoomScale = computed(() => timelineZoomPositionToScale(timelineZoom.value));

const timelineZoomMultiplierInput = computed(() => formatZoomPercent(timelineZoomScale.value));

function selectToolbarSnapMode(mode: ToolbarSnapMode) {
  settingsStore.selectToolbarSnapMode(mode);
}

function selectToolbarDragMode(mode: ToolbarDragMode) {
  settingsStore.selectToolbarDragMode(mode);
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

const standardTextPresets = computed<Record<string, { style: TextClipStyle; text?: string }>>(() => ({
  default: {
    style: { fontSize: 64, color: '#ffffff', fontFamily: 'sans-serif', width: 1280 },
  },
  title: {
    style: { fontSize: 96, fontWeight: '800', color: '#ffffff', fontFamily: 'sans-serif', width: 1280 },
    text: t('videoEditor.library.texts.title'),
  },
  subtitle: {
    style: { fontSize: 48, fontWeight: '400', color: '#aaaaaa', fontFamily: 'sans-serif', width: 1280 },
    text: t('videoEditor.library.texts.subtitle'),
  },
}));

function addTextClip(event?: MouseEvent) {
  const isShift = event?.shiftKey || false;

  if (isShift) {
    // Create clip without any preset style — preset will be applied after selection
    const clipIds = timelineStore.addTextClipAtPlayhead();
    if (clipIds.length > 0) {
      const trackId = timelineStore.timelineDoc?.tracks.find((t: any) =>
        t.items.some((it: any) => it.id === clipIds[0]),
      )?.id;
      if (trackId && clipIds[0]) {
        showPresetModal(trackId, clipIds[0]);
      }
    }
    return;
  }

  const presetId = presetsStore.defaultTextPresetId;
  const preset =
    standardTextPresets.value[presetId] ||
    presetsStore.customPresets.find((p) => p.id === presetId)?.params;

  if (preset) {
    timelineStore.addTextClipAtPlayhead({
      style: JSON.parse(JSON.stringify(toRaw(preset.style))),
      text: preset.text,
    });
  } else {
    timelineStore.addTextClipAtPlayhead();
  }
}

const textContextMenuItems = computed(() => [
  [
    {
      label: t('fastcat.library.texts.watchPresets', 'View presets'),
      icon: 'i-heroicons-sparkles',
      onSelect: () => {
        uiStore.activeLibraryTab = 'texts';
        projectTabsStore.setActiveTab('library');
      },
    },
  ],
]);

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

const { emptyAreaContextMenuItems: toolbarEmptyAreaContextMenuItems } =
  useTimelineEmptyAreaContextMenu();

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
      <div class="flex-1 flex items-center justify-center gap-2">
        <UFieldGroup class="inline-flex">
          <UiTooltip :text="t('fastcat.timeline.snapModeFullDescription')">
            <UButton
              size="xs"
              :variant="settingsStore.toolbarSnapMode === 'snap' ? 'solid' : 'ghost'"
              :color="settingsStore.toolbarSnapMode === 'snap' ? 'primary' : 'neutral'"
              icon="i-heroicons-link"
              class="hover:bg-ui-bg-hover/60"
              @click="selectToolbarSnapMode('snap')"
            />
          </UiTooltip>
          <UiTooltip :text="t('fastcat.timeline.snapModeFramesDescription')">
            <UButton
              size="xs"
              :variant="settingsStore.toolbarSnapMode === 'no_snap' ? 'solid' : 'ghost'"
              :color="settingsStore.toolbarSnapMode === 'no_snap' ? 'primary' : 'neutral'"
              icon="i-heroicons-link-slash"
              class="hover:bg-ui-bg-hover/60"
              @click="selectToolbarSnapMode('no_snap')"
            />
          </UiTooltip>
          <UiTooltip :text="t('fastcat.timeline.snapModeFreeDescription')">
            <UButton
              size="xs"
              :variant="settingsStore.toolbarSnapMode === 'free_mode' ? 'solid' : 'ghost'"
              :color="settingsStore.toolbarSnapMode === 'free_mode' ? 'primary' : 'neutral'"
              icon="i-heroicons-arrows-pointing-out"
              class="hover:bg-ui-bg-hover/60"
              @click="selectToolbarSnapMode('free_mode')"
            />
          </UiTooltip>
        </UFieldGroup>

        <UiTooltip :text="t('videoEditor.settings.snappingTitle', 'Snapping settings')">
          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            icon="i-heroicons-cog-6-tooth"
            class="hover:bg-ui-bg-hover/60"
            @click="isSnapSettingsModalOpen = true"
          />
        </UiTooltip>

        <div class="w-px h-4 bg-ui-border mx-1 opacity-50" />

        <UFieldGroup class="inline-flex">
          <UiTooltip v-for="opt in moveModeOptions" :key="opt.value" :text="opt.tooltip">
            <UButton
              size="xs"
              :variant="currentMoveMode === opt.value ? 'solid' : 'ghost'"
              :color="currentMoveMode === opt.value ? 'primary' : 'neutral'"
              :icon="opt.icon"
              class="hover:bg-ui-bg-hover/60"
              @click="currentMoveMode = opt.value"
            />
          </UiTooltip>
        </UFieldGroup>

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
        <div class="w-px h-4 bg-ui-border mx-1 opacity-50" />

        <UiTooltip
          :text="`${t('fastcat.timeline.addAdjustment')} (${t('fastcat.timeline.dragToTimeline', 'drag to timeline')})`"
        >
          <div draggable="true" @dragstart="onDragStart($event, 'adjustment')" @dragend="onDragEnd">
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
          <div draggable="true" @dragstart="onDragStart($event, 'background')" @dragend="onDragEnd">
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
          :text="`${t('fastcat.timeline.addText')} (${t('fastcat.timeline.dragToTimeline', 'drag to timeline')}). ${t('fastcat.timeline.shiftForPresets', 'Hold {key} to choose preset after insertion').replace('{key}', layer1Label)}`"
        >
          <UContextMenu :items="textContextMenuItems">
            <div
              draggable="true"
              @dragstart="onDragStart($event, 'text')"
              @dragend="onDragEnd"
            >
              <UButton
                size="xs"
                variant="ghost"
                color="neutral"
                icon="i-heroicons-chat-bubble-bottom-center-text"
                class="hover:bg-ui-bg-hover/60"
                @click="
                  (e) => {
                    addTextClip(e);
                    (e.currentTarget as HTMLElement).blur();
                  }
                "
              />
            </div>
          </UContextMenu>
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
      <div class="w-[240px] flex items-center gap-2 pl-4 border-l border-ui-border/30">
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
            :step="1"
            :default-value="DEFAULT_TIMELINE_ZOOM_POSITION"
            wheel-without-focus
          />
        </div>

        <span
          class="text-2xs font-mono tabular-nums text-ui-text-muted select-none leading-none w-12 text-center shrink-0 cursor-pointer hover:text-ui-text transition-colors"
          @click="timelineZoom = DEFAULT_TIMELINE_ZOOM_POSITION"
        >
          {{ timelineZoomMultiplierInput }}
        </span>

        <div class="w-px h-4 bg-ui-border mx-1 opacity-50" />

        <UiTooltip :text="t('fastcat.timeline.properties.title')">
          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            icon="i-heroicons-cog-6-tooth"
            class="hover:bg-ui-bg-hover/60"
            @click="timelineStore.selectTimelineProperties()"
          />
        </UiTooltip>
      </div>
    </div>

    <TimelineSnapSettingsModal />
  </UContextMenu>
</template>
