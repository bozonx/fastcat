<script setup lang="ts">
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import type { ToolbarSnapMode } from '~/stores/timeline-settings.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useTimelineSettingsStore } from '~/stores/timeline-settings.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import UiSliderInput from '~/components/ui/UiSliderInput.vue';
import MobileTrackMixerDrawer from './MobileTrackMixerDrawer.vue';
import MobileHistoryDrawer from './MobileHistoryDrawer.vue';
import MobileTimelineSettingsDrawer from './MobileTimelineSettingsDrawer.vue';
import MobileDrawerToolbar from './MobileDrawerToolbar.vue';

const timelineStore = useTimelineStore();
const settingsStore = useTimelineSettingsStore();

const { t } = useI18n();

const { selectedItemIds } = storeToRefs(timelineStore);

const hasSelection = computed(() => selectedItemIds.value.length > 0);

const isTrackMixerDrawerOpen = ref(false);
const isHistoryDrawerOpen = ref(false);
const isSnapDrawerOpen = ref(false);
const isSettingsDrawerOpen = ref(false);

const longPressTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const IS_LONG_PRESS_MS = 500;
const wasLastPressLong = ref(false);

// Snap mode options

interface SnapOption {
  value: ToolbarSnapMode;
  icon: string;
  label: string;
  description: string;
}

const snapModeOptions = computed<SnapOption[]>(() => [
  {
    value: 'snap',
    icon: 'i-heroicons-link',
    label: t('fastcat.timeline.snapMode', 'Snap mode'),
    description: t('fastcat.timeline.snapModeFullDescription'),
  },
  {
    value: 'no_snap',
    icon: 'i-heroicons-link-slash',
    label: t('fastcat.timeline.snapModeFramesDescription'),
    description: t('fastcat.timeline.snapModeFramesDescription'),
  },
  {
    value: 'free_mode',
    icon: 'i-heroicons-arrows-pointing-out',
    label: t('fastcat.timeline.snapModeFreeDescription'),
    description: t('fastcat.timeline.snapModeFreeDescription'),
  },
]);

const currentSnapOption = computed(
  () =>
    snapModeOptions.value.find((o) => o.value === settingsStore.toolbarSnapMode) ??
    snapModeOptions.value[0]!,
);

// Snap detail settings (same as SettingsSnapping.vue)

const snapThresholdPx = computed({
  get: () => workspaceStore.userSettings.timeline.snapThresholdPx,
  set: (val: number) => settingsStore.setGlobalSnapThresholdPx(val),
});

const snapToTimelineEdges = computed({
  get: () => workspaceStore.userSettings.timeline.snapping.timelineEdges,
  set: (val: boolean) => (workspaceStore.userSettings.timeline.snapping.timelineEdges = val),
});

const snapToClips = computed({
  get: () => workspaceStore.userSettings.timeline.snapping.clips,
  set: (val: boolean) => (workspaceStore.userSettings.timeline.snapping.clips = val),
});

const snapToMarkers = computed({
  get: () => workspaceStore.userSettings.timeline.snapping.markers,
  set: (val: boolean) => (workspaceStore.userSettings.timeline.snapping.markers = val),
});

const snapToSelection = computed({
  get: () => workspaceStore.userSettings.timeline.snapping.selection,
  set: (val: boolean) => (workspaceStore.userSettings.timeline.snapping.selection = val),
});

const snapToPlayhead = computed({
  get: () => workspaceStore.userSettings.timeline.snapping.playhead,
  set: (val: boolean) => (workspaceStore.userSettings.timeline.snapping.playhead = val),
});

const isPseudoOverlapMode = computed(
  () => settingsStore.toolbarDragModeEnabled && settingsStore.toolbarDragMode === 'pseudo_overlap',
);

function togglePseudoOverlapMode() {
  if (isPseudoOverlapMode.value) {
    settingsStore.toolbarDragModeEnabled = false;
  } else {
    settingsStore.selectToolbarDragMode('pseudo_overlap');
  }
}

const rippleTrimDisabled = computed(() => timelineStore.getHotkeyTargetClip() === null);

function startLongPress() {
  wasLastPressLong.value = false;
  if (longPressTimer.value) clearTimeout(longPressTimer.value);
  longPressTimer.value = setTimeout(() => {
    isHistoryDrawerOpen.value = true;
    wasLastPressLong.value = true;
    longPressTimer.value = null;
    if (navigator.vibrate) navigator.vibrate(50);
  }, IS_LONG_PRESS_MS);
}

function stopLongPress() {
  if (longPressTimer.value) {
    clearTimeout(longPressTimer.value);
    longPressTimer.value = null;
  }
}

function handleSplit() {
  if (hasSelection.value) {
    timelineStore.splitClipsAtPlayhead();
  } else {
    timelineStore.splitAllClipsAtPlayhead();
  }
}

function handleUndo() {
  if (wasLastPressLong.value) return;
  timelineStore.undoTimeline();
}

function handleRedo() {
  if (wasLastPressLong.value) return;
  timelineStore.redoTimeline();
}

function handleRippleTrimLeft() {
  void timelineStore.rippleTrimLeft();
}

function handleRippleTrimRight() {
  void timelineStore.rippleTrimRight();
}
</script>

<template>
  <div
    class="flex items-center justify-between gap-2 border-b border-ui-border bg-ui-bg-elevated px-2 py-2 shadow-sm"
  >
    <MobileDrawerToolbar variant="toolbar" content-class="gap-2 py-0">
      <div class="flex items-center gap-1 rounded-xl bg-ui-bg px-1 py-1 shrink-0">
        <UiActionButton
          icon="lucide:undo"
          color="neutral"
          size="sm"
          title="Undo"
          :disabled="!timelineStore.historyStore.canUndo('timeline')"
          @click="handleUndo"
          @pointerdown="startLongPress"
          @pointerup="stopLongPress"
          @pointerleave="stopLongPress"
        />
        <UiActionButton
          icon="lucide:redo"
          color="neutral"
          size="sm"
          title="Redo"
          :disabled="!timelineStore.historyStore.canRedo('timeline')"
          @click="handleRedo"
          @pointerdown="startLongPress"
          @pointerup="stopLongPress"
          @pointerleave="stopLongPress"
        />
      </div>

      <!-- Snap mode: single button shows active icon, opens settings drawer -->
      <div class="flex items-center gap-1 rounded-xl bg-ui-bg px-1 py-1 shrink-0">
        <UiActionButton
          :icon="currentSnapOption.icon"
          color="primary"
          variant="soft"
          size="sm"
          :title="currentSnapOption.label"
          @click="isSnapDrawerOpen = true"
        />
      </div>

      <div class="flex items-center gap-1 rounded-xl bg-ui-bg px-1 py-1 shrink-0">
        <UiActionButton
          icon="i-heroicons-rectangle-stack"
          :variant="isPseudoOverlapMode ? 'solid' : 'ghost'"
          :color="isPseudoOverlapMode ? 'primary' : 'neutral'"
          size="sm"
          :title="t('fastcat.timeline.moveModePseudoDescription')"
          @click="togglePseudoOverlapMode"
        />
      </div>

      <div class="flex items-center gap-1 rounded-xl bg-ui-bg px-1 py-1 shrink-0">
        <UiActionButton
          icon="i-lucide-scissors"
          color="neutral"
          size="sm"
          title="Split"
          @click="handleSplit"
        />
        <UiActionButton
          icon="i-heroicons-arrow-left"
          color="neutral"
          size="sm"
          :disabled="rippleTrimDisabled"
          :title="t('fastcat.timeline.rippleTrimLeft', 'Ripple trim left')"
          @click="handleRippleTrimLeft"
        />
        <UiActionButton
          icon="i-heroicons-arrow-right"
          color="neutral"
          size="sm"
          :disabled="rippleTrimDisabled"
          :title="t('fastcat.timeline.rippleTrimRight', 'Ripple trim right')"
          @click="handleRippleTrimRight"
        />
      </div>
    </MobileDrawerToolbar>

    <div class="flex items-center shrink-0 border-l border-ui-border pl-2 ml-1">
      <UiActionButton
        icon="lucide:sliders"
        color="neutral"
        size="sm"
        title="Mixer & Tracks"
        @click="isTrackMixerDrawerOpen = true"
      />
      <UiActionButton
        icon="lucide:settings"
        color="neutral"
        size="sm"
        title="Timeline settings"
        class="ml-1"
        @click="isSettingsDrawerOpen = true"
      />
    </div>
  </div>

  <!-- Snap mode drawer -->
  <UiMobileDrawer
    v-model:open="isSnapDrawerOpen"
    :show-close="false"
    direction="bottom"
  >
    <div class="px-4 pb-6 flex flex-col gap-5">
      <!-- Snap mode selector -->
      <div class="flex flex-col gap-2">
        <button
          v-for="opt in snapModeOptions"
          :key="opt.value"
          class="flex items-center gap-3 rounded-xl px-4 py-3 transition-colors"
          :class="
            settingsStore.toolbarSnapMode === opt.value
              ? 'bg-primary-500/15 text-primary-500'
              : 'bg-ui-bg text-ui-text hover:bg-ui-bg-hover'
          "
          @click="
            settingsStore.selectToolbarSnapMode(opt.value);
            isSnapDrawerOpen = false;
          "
        >
          <UIcon :name="opt.icon" class="size-5 shrink-0" />
          <span class="text-sm font-medium leading-snug">{{ opt.description }}</span>
          <UIcon
            v-if="settingsStore.toolbarSnapMode === opt.value"
            name="i-heroicons-check"
            class="size-4 ml-auto shrink-0"
          />
        </button>
      </div>

      <div class="h-px bg-ui-border" />

      <!-- Snap threshold -->
      <UiSliderInput
        v-model="snapThresholdPx"
        :label="t('videoEditor.settings.snapThresholdDefault', 'Snap threshold')"
        :min="1"
        :max="100"
        :step="1"
        :default-value="8"
        unit="px"
      />

      <!-- Snap targets -->
      <div class="flex flex-col gap-3">
        <p class="text-sm font-medium text-ui-text">
          {{ t('videoEditor.settings.snapToTargets', 'Snap to') }}
        </p>
        <UCheckbox
          v-model="snapToTimelineEdges"
          :label="t('videoEditor.settings.snapToTimelineEdges', 'Timeline start and end')"
        />
        <UCheckbox v-model="snapToClips" :label="t('videoEditor.settings.snapToClips', 'Clips')" />
        <UCheckbox
          v-model="snapToMarkers"
          :label="t('videoEditor.settings.snapToMarkers', 'Markers')"
        />
        <UCheckbox
          v-model="snapToSelection"
          :label="t('videoEditor.settings.snapToSelection', 'Selection')"
        />
        <UCheckbox
          v-model="snapToPlayhead"
          :label="t('videoEditor.settings.snapToPlayhead', 'Playhead')"
        />
      </div>
    </div>
  </UiMobileDrawer>

  <MobileTrackMixerDrawer
    :is-open="isTrackMixerDrawerOpen"
    @close="isTrackMixerDrawerOpen = false"
  />

  <MobileHistoryDrawer :is-open="isHistoryDrawerOpen" @close="isHistoryDrawerOpen = false" />
</template>


