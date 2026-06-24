<script setup lang="ts">
import { computed, toRaw } from 'vue';
import { storeToRefs } from 'pinia';
import { cloneValue } from '~/utils/clone';
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
} from '~/utils/zoom';
import { LAYER_OPTIONS } from '~/utils/hotkeys/layerUtils';
import type { TextClipStyle } from '~/timeline/types';
import { useTimelineTextPreset } from '~/composables/timeline/useTimelineTextPreset';
import { useUiStore } from '~/stores/ui.store';
import TimelineSnapSettingsModal from './TimelineSnapSettingsModal.vue';
import { useHotkeyLabel } from '~/composables/useHotkeyLabel';

import { useTimelineEmptyAreaContextMenu } from '~/composables/timeline/useTimelineEmptyAreaContextMenu';

const { t } = useI18n();
const { getHotkeyTitle, getHotkeyLabel } = useHotkeyLabel();
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
    LAYER_OPTIONS.find((o) => o.value === key)?.label || (key === 'Shift' ? 'Shift (Any)' : key)
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

  const keyTrimL = getHotkeyLabel('timeline.trimToPlayheadLeft');
  const keyTrimR = getHotkeyLabel('timeline.trimToPlayheadRight');
  const keyRippleL = getHotkeyLabel('timeline.rippleTrimLeft');
  const keyRippleR = getHotkeyLabel('timeline.rippleTrimRight');
  const keyAdvL = getHotkeyLabel('timeline.advancedRippleTrimLeft');
  const keyAdvR = getHotkeyLabel('timeline.advancedRippleTrimRight');
  const keySplit = getHotkeyLabel('timeline.splitAtPlayhead');
  const keySplitAll = getHotkeyLabel('timeline.splitAllAtPlayhead');

  const formatLabel = (text: string, key?: string | null) => (key ? `${text} (${key})` : text);

  return [
    [
      {
        label: formatLabel(t('videoEditor.hotkeys.timeline.trimToPlayheadLeft'), keyTrimL),
        icon: 'i-heroicons-scissors',
        disabled: isNoClipSelected,
        onSelect: () => timelineStore.trimToPlayheadLeftNoRipple(),
      },
      {
        label: formatLabel(t('videoEditor.hotkeys.timeline.trimToPlayheadRight'), keyTrimR),
        icon: 'i-heroicons-scissors',
        disabled: isNoClipSelected,
        onSelect: () => timelineStore.trimToPlayheadRightNoRipple(),
      },
    ],
    [
      {
        label: formatLabel(t('videoEditor.hotkeys.timeline.rippleTrimLeft'), keyRippleL),
        icon: 'i-heroicons-arrow-left',
        disabled: isNoClipSelected,
        onSelect: () => timelineStore.rippleTrimLeft(),
      },
      {
        label: formatLabel(t('videoEditor.hotkeys.timeline.rippleTrimRight'), keyRippleR),
        icon: 'i-heroicons-arrow-right',
        disabled: isNoClipSelected,
        onSelect: () => timelineStore.rippleTrimRight(),
      },
    ],
    [
      {
        label: formatLabel(t('videoEditor.hotkeys.timeline.advancedRippleTrimLeft'), keyAdvL),
        icon: 'i-heroicons-backward',
        disabled: isNoClipSelected,
        onSelect: () => timelineStore.advancedRippleTrimLeft(),
      },
      {
        label: formatLabel(t('videoEditor.hotkeys.timeline.advancedRippleTrimRight'), keyAdvR),
        icon: 'i-heroicons-forward',
        disabled: isNoClipSelected,
        onSelect: () => timelineStore.advancedRippleTrimRight(),
      },
    ],
    [
      {
        label: formatLabel(t('videoEditor.hotkeys.timeline.splitAtPlayhead'), keySplit),
        icon: 'i-heroicons-scissors',
        onSelect: () => timelineStore.splitClipAtPlayhead(),
      },
      {
        label: formatLabel(t('videoEditor.hotkeys.timeline.splitAllAtPlayhead'), keySplitAll),
        icon: 'i-heroicons-scissors',
        onSelect: () => timelineStore.splitAllClipsAtPlayhead(),
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

const zoomCombinedTooltip = computed(() => {
  const zoomInLabel = getHotkeyLabel('general.zoomIn');
  const zoomOutLabel = getHotkeyLabel('general.zoomOut');
  const zoomResetLabel = getHotkeyLabel('general.zoomReset');
  const zoomFitLabel = getHotkeyLabel('general.zoomFit');

  const parts = [];
  if (zoomInLabel) parts.push(`${t('videoEditor.hotkeys.general.zoomIn')} (${zoomInLabel})`);
  if (zoomOutLabel) parts.push(`${t('videoEditor.hotkeys.general.zoomOut')} (${zoomOutLabel})`);
  if (zoomResetLabel)
    parts.push(`${t('videoEditor.hotkeys.general.zoomReset')} (${zoomResetLabel})`);
  if (zoomFitLabel) parts.push(`${t('fastcat.timeline.zoomToFit')} (${zoomFitLabel})`);

  return parts.join(' | ');
});

function selectToolbarSnapMode(mode: ToolbarSnapMode) {
  settingsStore.selectToolbarSnapMode(mode);
}

function toggleTrimMode(event?: MouseEvent) {
  event?.preventDefault();
  event?.stopPropagation();
  timelineStore.isTrimModeActive = !timelineStore.isTrimModeActive;
}

const isSnapSettingsDisabled = computed(() => settingsStore.toolbarSnapMode !== 'snap');

const standardTextPresets = computed<Record<string, { style: TextClipStyle; text?: string }>>(
  () => ({
    default: {
      style: { fontSize: 64, color: '#ffffff', fontFamily: 'sans-serif', width: 1280 },
    },
    title: {
      style: {
        fontSize: 96,
        fontWeight: '800',
        color: '#ffffff',
        fontFamily: 'sans-serif',
        width: 1280,
      },
      text: t('videoEditor.library.texts.title'),
    },
    subtitle: {
      style: {
        fontSize: 48,
        fontWeight: '400',
        color: '#aaaaaa',
        fontFamily: 'sans-serif',
        width: 1280,
      },
      text: t('videoEditor.library.texts.subtitle'),
    },
  }),
);

function addTextClip(event?: MouseEvent) {
  const isShift = event?.shiftKey || false;

  if (isShift) {
    // Create clip without any preset style — preset will be applied after selection
    const clipIds = timelineStore.addTextClipAtPlayhead();
    if (clipIds.length > 0) {
      const trackId = timelineStore.timelineDoc?.tracks.find(
        (t: { items: Array<{ id: string }> }) =>
          t.items.some((it: { id: string }) => it.id === clipIds[0]),
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
      style: cloneValue(toRaw(preset.style)) as TextClipStyle,
      text: preset.text as string | undefined,
    });
  } else {
    timelineStore.addTextClipAtPlayhead();
  }
}

const textContextMenuItems = computed(() => [
  [
    {
      label: t('fastcat.library.texts.watchPresets'),
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
      <div
        class="flex-1 flex items-center justify-center gap-2"
        @click.self="timelineStore.selectTimelineProperties()"
      >
        <UFieldGroup class="inline-flex">
          <UiTooltip
            :text="
              getHotkeyTitle(
                t('fastcat.timeline.snapModeFullDescription'),
                'timeline.selectSnapModeSnap',
              )
            "
          >
            <UButton
              size="xs"
              :variant="settingsStore.toolbarSnapMode === 'snap' ? 'solid' : 'ghost'"
              :color="settingsStore.toolbarSnapMode === 'snap' ? 'primary' : 'neutral'"
              icon="i-heroicons-link"
              class="hover:bg-ui-bg-hover/60"
              @click="selectToolbarSnapMode('snap')"
            />
          </UiTooltip>
          <UiTooltip
            :text="
              getHotkeyTitle(
                t('fastcat.timeline.snapModeFramesDescription'),
                'timeline.selectSnapModeNoSnap',
              )
            "
          >
            <UButton
              size="xs"
              :variant="settingsStore.toolbarSnapMode === 'no_snap' ? 'solid' : 'ghost'"
              :color="settingsStore.toolbarSnapMode === 'no_snap' ? 'primary' : 'neutral'"
              icon="i-heroicons-link-slash"
              class="hover:bg-ui-bg-hover/60"
              @click="selectToolbarSnapMode('no_snap')"
            />
          </UiTooltip>
          <UiTooltip
            :text="
              getHotkeyTitle(
                t('fastcat.timeline.snapModeFreeDescription'),
                'timeline.selectSnapModeFree',
              )
            "
          >
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

        <UiTooltip :text="t('videoEditor.settings.snappingTitle')">
          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            icon="i-heroicons-cog-6-tooth"
            class="hover:bg-ui-bg-hover/60"
            :disabled="isSnapSettingsDisabled"
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

        <UiTooltip :text="t('fastcat.timeline.trim')">
          <UiSplitDropdownButton
            v-bind="
              {
                size: 'xs',
                variant: timelineStore.isTrimModeActive ? 'solid' : 'ghost',
                color: timelineStore.isTrimModeActive ? 'primary' : 'neutral',
                icon: 'i-heroicons-scissors',
                'aria-label': t('fastcat.timeline.trim'),
                items: trimMenuItems,
                buttonClass: 'hover:bg-ui-bg-hover/60',
                caretButtonClass: 'px-0.5 hover:bg-ui-bg-hover/60',
                caretIconClass: 'size-2.5',
                onClick: toggleTrimMode,
                disabled: timelineStore.previewMode,
              } as any
            "
          />
        </UiTooltip>

        <div v-if="timelineStore.isAnyTrackSoloed" class="ml-2 flex items-center">
          <UiTooltip :text="t('fastcat.timeline.clearSolos')">
            <UButton
              size="xs"
              color="amber"
              variant="solid"
              icon="i-heroicons-musical-note"
              class="h-6 text-2xs px-2 gap-1 font-bold animate-pulse hover:animate-none"
              :disabled="timelineStore.previewMode"
              @click="
                (e) => {
                  timelineStore.unsoloAllTracks();
                  (e.currentTarget as HTMLElement).blur();
                }
              "
            >
              {{ t('fastcat.timeline.soloActive') }}
            </UButton>
          </UiTooltip>
        </div>
        <div class="w-px h-4 bg-ui-border mx-1 opacity-50" />

        <UiTooltip
          :text="`${t('fastcat.timeline.addAdjustment')} (${t('fastcat.timeline.dragToTimeline')})`"
        >
          <div draggable="true" @dragstart="onDragStart($event, 'adjustment')" @dragend="onDragEnd">
            <UButton
              size="xs"
              variant="ghost"
              color="neutral"
              icon="i-heroicons-adjustments-horizontal"
              class="hover:bg-ui-bg-hover/60"
              :disabled="timelineStore.previewMode"
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
          :text="`${t('fastcat.timeline.addBackground')} (${t('fastcat.timeline.dragToTimeline')})`"
        >
          <div draggable="true" @dragstart="onDragStart($event, 'background')" @dragend="onDragEnd">
            <UButton
              size="xs"
              variant="ghost"
              color="neutral"
              icon="i-heroicons-swatch"
              class="hover:bg-ui-bg-hover/60"
              :disabled="timelineStore.previewMode"
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
          :text="`${t('fastcat.timeline.addText')} (${t('fastcat.timeline.dragToTimeline')}). ${t('fastcat.timeline.shiftForPresets').replace('{key}', layer1Label)}`"
        >
          <UContextMenu :items="textContextMenuItems">
            <div draggable="true" @dragstart="onDragStart($event, 'text')" @dragend="onDragEnd">
              <UButton
                size="xs"
                variant="ghost"
                color="neutral"
                icon="i-heroicons-chat-bubble-bottom-center-text"
                class="hover:bg-ui-bg-hover/60"
                :disabled="timelineStore.previewMode"
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
          <UiTooltip
            :text="getHotkeyTitle(t('fastcat.timeline.previousMarker'), 'general.prevMarker')"
          >
            <UButton
              size="xs"
              variant="ghost"
              color="neutral"
              icon="i-heroicons-chevron-left"
              class="hover:bg-ui-bg-hover/60"
              @click="timelineStore.goToPreviousMarker()"
            />
          </UiTooltip>

          <UiTooltip :text="getHotkeyTitle(t('fastcat.timeline.addMarker'), 'general.addMarker')">
            <UButton
              size="xs"
              variant="ghost"
              color="neutral"
              icon="i-heroicons-bookmark"
              class="hover:bg-ui-bg-hover/60"
              :disabled="timelineStore.previewMode"
              @click="timelineStore.addMarkerAtPlayhead()"
            />
          </UiTooltip>

          <UiTooltip :text="getHotkeyTitle(t('fastcat.timeline.nextMarker'), 'general.nextMarker')">
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
      <div
        class="w-[240px] flex items-center gap-2 pl-4 border-l border-ui-border/30"
        @click.self="timelineStore.selectTimelineProperties()"
      >
        <UiTooltip :text="getHotkeyTitle(t('fastcat.timeline.zoomToFit'), 'general.zoomFit')">
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-heroicons-arrows-pointing-out"
            class="hover:bg-ui-bg-hover/60"
            @click="timelineStore.fitTimelineZoom()"
          />
        </UiTooltip>

        <UiTooltip :text="zoomCombinedTooltip" class="flex-1 min-w-0">
          <UiWheelSlider
            v-model="timelineZoom"
            :min="MIN_TIMELINE_ZOOM_POSITION"
            :max="MAX_TIMELINE_ZOOM_POSITION"
            :step="1"
            :default-value="DEFAULT_TIMELINE_ZOOM_POSITION"
            wheel-without-focus
          />
        </UiTooltip>

        <UiTooltip :text="zoomCombinedTooltip">
          <span
            class="text-2xs font-mono tabular-nums text-ui-text-muted select-none leading-none w-12 text-center shrink-0 cursor-pointer hover:text-ui-text transition-colors"
            @click="timelineZoom = DEFAULT_TIMELINE_ZOOM_POSITION"
          >
            {{ timelineZoomMultiplierInput }}
          </span>
        </UiTooltip>

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
