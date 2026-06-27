<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useTimelineSettingsStore } from '~/stores/timeline-settings.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useAppClipboard } from '~/composables/useAppClipboard';
import MobileDrawerToolbar from './MobileDrawerToolbar.vue';
import SnapSettingsPanel from '~/components/settings/SnapSettingsPanel.vue';
import { useSnapSettings } from '~/composables/timeline/useSnapSettings';

import { MOBILE_LONG_PRESS_MS } from '~/utils/mobile/timeline';

const timelineStore = useTimelineStore();
const settingsStore = useTimelineSettingsStore();
const workspaceStore = useWorkspaceStore();
const clipboardStore = useAppClipboard();

const { t } = useI18n();

const hasClipboard = computed(() => clipboardStore.hasTimelinePayload);

const isSnapDrawerOpen = ref(false);

const snapLongPressTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const wasSnapPressLong = ref(false);

const longPressTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const wasLastPressLong = ref(false);

const emit = defineEmits<{
  (e: 'open-track-mixer'): void;
  (e: 'open-track-manager'): void;
  (e: 'open-history'): void;
  (e: 'open-markers'): void;
}>();

const { currentSnapOption } = useSnapSettings();

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

function startLongPress() {
  wasLastPressLong.value = false;
  if (!workspaceStore.userSettings.experimentalFeatures) return;
  if (longPressTimer.value) clearTimeout(longPressTimer.value);
  longPressTimer.value = setTimeout(() => {
    emit('open-history');
    wasLastPressLong.value = true;
    longPressTimer.value = null;
    if (navigator.vibrate) navigator.vibrate(50);
  }, MOBILE_LONG_PRESS_MS);
}

function stopLongPress() {
  if (longPressTimer.value) {
    clearTimeout(longPressTimer.value);
    longPressTimer.value = null;
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

function handlePaste() {
  const payload = clipboardStore.clipboardPayload;
  if (!payload || payload.source !== 'timeline' || payload.items.length === 0) return;
  const playheadUs = timelineStore.currentTime;
  void timelineStore.pasteClips(payload.items, { insertStartUs: playheadUs });
  if (payload.operation === 'cut') clipboardStore.setClipboardPayload(null);
}

function handleSnapToggle() {
  if (wasSnapPressLong.value) {
    wasSnapPressLong.value = false;
    return;
  }
  settingsStore.toggleToolbarSnapMode();
  if (navigator.vibrate) navigator.vibrate(20);
}

function startSnapLongPress() {
  wasSnapPressLong.value = false;
  if (snapLongPressTimer.value) clearTimeout(snapLongPressTimer.value);
  snapLongPressTimer.value = setTimeout(() => {
    isSnapDrawerOpen.value = true;
    wasSnapPressLong.value = true;
    snapLongPressTimer.value = null;
    if (navigator.vibrate) navigator.vibrate(50);
  }, MOBILE_LONG_PRESS_MS);
}

function stopSnapLongPress() {
  if (snapLongPressTimer.value) {
    clearTimeout(snapLongPressTimer.value);
    snapLongPressTimer.value = null;
  }
}
</script>

<template>
  <div
    class="mobile-timeline-toolbar flex items-center justify-between gap-2 border-b border-ui-border bg-ui-bg-elevated px-2 py-2 shadow-sm"
  >
    <MobileDrawerToolbar content-class="gap-2 py-0">
      <div class="flex items-center gap-1 rounded-xl bg-ui-bg px-1 py-1 shrink-0">
        <UiActionButton
          icon="lucide:undo"
          color="neutral"
          size="sm"
          :title="t('common.undo')"
          :disabled="!timelineStore.historyStore.canUndo('timeline')"
          disable-mobile-tooltip
          @click="handleUndo"
          @pointerdown="startLongPress"
          @pointerup="stopLongPress"
          @pointerleave="stopLongPress"
        />
        <UiActionButton
          icon="lucide:redo"
          color="neutral"
          size="sm"
          :title="t('common.redo')"
          :disabled="!timelineStore.historyStore.canRedo('timeline')"
          disable-mobile-tooltip
          @click="handleRedo"
          @pointerdown="startLongPress"
          @pointerup="stopLongPress"
          @pointerleave="stopLongPress"
        />
        <UiActionButton
          v-if="hasClipboard"
          icon="i-heroicons-clipboard-document-check"
          color="primary"
          variant="soft"
          size="sm"
          :title="t('common.paste')"
          @click="handlePaste"
        />
      </div>

      <!-- Snap mode -->
      <div class="flex items-center gap-1 rounded-xl bg-ui-bg px-1 py-1 shrink-0">
        <UiActionButton
          :icon="currentSnapOption.icon"
          :color="settingsStore.toolbarSnapMode === 'no_snap' ? 'neutral' : 'primary'"
          :variant="settingsStore.toolbarSnapMode === 'no_snap' ? 'ghost' : 'soft'"
          size="sm"
          :title="currentSnapOption.label"
          disable-mobile-tooltip
          @click="handleSnapToggle"
          @pointerdown="startSnapLongPress"
          @pointerup="stopSnapLongPress"
          @pointerleave="stopSnapLongPress"
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

      <div
        v-if="workspaceStore.userSettings.experimentalFeatures"
        class="flex items-center gap-1 rounded-xl bg-ui-bg px-1 py-1 shrink-0"
      >
        <UiActionButton
          icon="lucide:history"
          color="neutral"
          size="sm"
          :title="t('common.history')"
          @click="emit('open-history')"
        />
        <UiActionButton
          icon="lucide:map-pin"
          color="neutral"
          size="sm"
          :title="t('common.markers')"
          @click="emit('open-markers')"
        />
      </div>
    </MobileDrawerToolbar>

    <div class="flex items-center shrink-0 border-l border-ui-border pl-2 ml-1">
      <UiActionButton
        icon="lucide:layers"
        color="neutral"
        size="sm"
        :title="t('fastcat.timeline.trackManager')"
        class="mr-1"
        @click="emit('open-track-manager')"
      />
      <UiActionButton
        icon="lucide:sliders"
        color="neutral"
        size="sm"
        :title="t('fastcat.timeline.mixerAndTracks')"
        @click="emit('open-track-mixer')"
      />
      <UiActionButton
        icon="lucide:settings"
        color="neutral"
        size="sm"
        :title="t('fastcat.timeline.timelineSettings')"
        class="ml-1"
        @click="timelineStore.selectTimelineProperties()"
      />
    </div>
  </div>

  <!-- Snap mode drawer -->
  <UiMobileDrawer v-model:open="isSnapDrawerOpen" :show-close="false">
    <div class="px-4 pb-6">
      <SnapSettingsPanel />
    </div>
  </UiMobileDrawer>
</template>
