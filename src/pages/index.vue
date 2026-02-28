<script setup lang="ts">
import { ref } from 'vue';
import { Splitpanes, Pane } from 'splitpanes';
import 'splitpanes/dist/splitpanes.css';
import { useLocalStorage } from '@vueuse/core';
import TimelineExportModal from '~/components/TimelineExportModal.vue';
import EditorSettingsModal from '~/components/EditorSettingsModal.vue';
import ProjectSettingsModal from '~/components/ProjectSettingsModal.vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useUiStore } from '~/stores/ui.store';
import { useMediaStore } from '~/stores/media.store';
import { storeToRefs } from 'pinia';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import { getEffectiveHotkeyBindings } from '~/utils/hotkeys/effectiveHotkeys';
import { hotkeyFromKeyboardEvent, isEditableTarget } from '~/utils/hotkeys/hotkeyUtils';
import TimelineTabs from '~/components/timeline/TimelineTabs.vue';
import { DEFAULT_HOTKEYS, type HotkeyCommandId } from '~/utils/hotkeys/defaultHotkeys';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const projectStore = useProjectStore();
const timelineStore = useTimelineStore();
const uiStore = useUiStore();
const mediaStore = useMediaStore();
const focusStore = useFocusStore();
const selectionStore = useSelectionStore();
const fm = useFileManager();

const { currentTimelinePath } = storeToRefs(projectStore);

const isExportModalOpen = ref(false);
const isEditorSettingsOpen = ref(false);
const isProjectSettingsOpen = ref(false);

function onGlobalDragOver(e: DragEvent) {
  const types = e.dataTransfer?.types;
  if (!types) return;
  // Ignore internal drags (files dragged within the app from the file manager)
  if (types.includes('application/gran-internal-file')) return;
  if (types.includes('Files')) {
    uiStore.isGlobalDragging = true;
  }
}

function onGlobalDragLeave(e: DragEvent) {
  if (!e.relatedTarget) {
    uiStore.isGlobalDragging = false;
  }
}

async function onGlobalDrop(e: DragEvent) {
  uiStore.isGlobalDragging = false;

  // if uiStore.isFileManagerDragging is true, filemanager itself will handle the drop
  if (uiStore.isFileManagerDragging) return;

  // Snapshot files synchronously — dataTransfer.files becomes empty after any await
  const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
  if (files.length === 0) return;
  if (!workspaceStore.projectsHandle || !projectStore.currentProjectName) return;

  const { useFileManager } = await import('~/composables/fileManager/useFileManager');
  const fm = useFileManager();
  await fm.handleFiles(files);
}

let volumeHoldTimeout: number | null = null;
let volumeHoldInterval: number | null = null;
let volumeHoldKeyCode: string | null = null;

let zoomHoldTimeout: number | null = null;
let zoomHoldInterval: number | null = null;
let zoomHoldKeyCode: string | null = null;

const suppressedKeyupCodes = new Set<string>();

function clearVolumeHoldTimers() {
  if (volumeHoldTimeout !== null) {
    window.clearTimeout(volumeHoldTimeout);
    volumeHoldTimeout = null;
  }
  if (volumeHoldInterval !== null) {
    window.clearInterval(volumeHoldInterval);
    volumeHoldInterval = null;
  }
  volumeHoldKeyCode = null;
}

function clearZoomHoldTimers() {
  if (zoomHoldTimeout !== null) {
    window.clearTimeout(zoomHoldTimeout);
    zoomHoldTimeout = null;
  }
  if (zoomHoldInterval !== null) {
    window.clearInterval(zoomHoldInterval);
    zoomHoldInterval = null;
  }
  zoomHoldKeyCode = null;
}

function startVolumeHotkeyHold(params: { step: number; keyCode: string }) {
  clearVolumeHoldTimers();
  volumeHoldKeyCode = params.keyCode;

  timelineStore.setAudioVolume(timelineStore.audioVolume + params.step);

  volumeHoldTimeout = window.setTimeout(() => {
    volumeHoldInterval = window.setInterval(() => {
      timelineStore.setAudioVolume(timelineStore.audioVolume + params.step);
    }, 60);
  }, 350);
}

function startZoomHotkeyHold(params: { step: number; keyCode: string }) {
  clearZoomHoldTimers();
  zoomHoldKeyCode = params.keyCode;

  timelineStore.setTimelineZoom(timelineStore.timelineZoom + params.step);

  zoomHoldTimeout = window.setTimeout(() => {
    zoomHoldInterval = window.setInterval(() => {
      timelineStore.setTimelineZoom(timelineStore.timelineZoom + params.step);
    }, 60);
  }, 350);
}

async function onGlobalKeydown(e: KeyboardEvent) {
  if (e.defaultPrevented) return;
  if (e.repeat) return;

  if (document.querySelector('[role="dialog"]')) return;

  if (e.key === 'Tab' && focusStore.tempFocus !== 'none') {
    e.preventDefault();
    focusStore.handleFocusHotkey();
    return;
  }

  if (isEditableTarget(e.target)) return;
  if (isEditableTarget(document.activeElement)) return;

  const combo = hotkeyFromKeyboardEvent(e);
  if (!combo) return;

  const effective = getEffectiveHotkeyBindings(workspaceStore.userSettings.hotkeys);

  const cmdOrder = DEFAULT_HOTKEYS.commands.map((c) => c.id);
  const matched: HotkeyCommandId[] = [];
  for (const cmdId of cmdOrder) {
    const bindings = effective[cmdId];
    if (bindings.includes(combo)) {
      matched.push(cmdId);
    }
  }
  if (matched.length === 0) return;

  const focusAware = (() => {
    const order: HotkeyCommandId[] = [];

    const timeline = matched.filter((c) => c.startsWith('timeline.'));
    const playback = matched.filter((c) => c.startsWith('playback.'));
    const general = matched.filter((c) => c.startsWith('general.'));

    if (focusStore.canUseTimelineHotkeys) {
      order.push(...timeline, ...general, ...playback);
    } else if (focusStore.canUsePlaybackHotkeys) {
      order.push(...playback, ...general, ...timeline);
    } else {
      order.push(...general, ...timeline, ...playback);
    }

    return order[0] ?? matched[0]!;
  })();

  if (document.activeElement instanceof HTMLElement) {
    if (!isEditableTarget(document.activeElement)) {
      document.activeElement.blur();
    }
  }

  e.preventDefault();
  e.stopPropagation();
  (e as any).stopImmediatePropagation?.();
  suppressedKeyupCodes.add(e.code);

  const cmd: string = focusAware;
  if (cmd === 'general.focus') {
    focusStore.handleFocusHotkey();
    return;
  }

  if (cmd === 'general.undo') {
    timelineStore.undoTimeline();
    return;
  }

  if (cmd === 'general.redo') {
    timelineStore.redoTimeline();
    return;
  }

  if (cmd === 'general.delete') {
    const selected = selectionStore.selectedEntity;
    if (selected?.source === 'fileManager') {
      uiStore.pendingFsEntryDelete = selected.entry;
    } else if (selected?.source === 'timeline') {
      if (selected.kind === 'track') {
        timelineStore.deleteTrack(selected.trackId, { allowNonEmpty: true });
        selectionStore.clearSelection();
      } else {
        timelineStore.deleteFirstSelectedItem();
      }
    } else if (timelineStore.selectedItemIds.length > 0) {
      timelineStore.deleteFirstSelectedItem();
    }
    return;
  }

  if (cmd === 'general.deselect') {
    selectionStore.clearSelection();
    timelineStore.clearSelection();
    timelineStore.selectTrack(null);
    return;
  }

  if (cmd === 'timeline.rippleDelete') {
    if (!focusStore.canUseTimelineHotkeys) return;
    timelineStore.rippleDeleteFirstSelectedItem();
    return;
  }

  if (cmd === 'timeline.trimToPlayheadLeft') {
    if (!focusStore.canUseTimelineHotkeys) return;
    void timelineStore.trimToPlayheadLeftNoRipple();
    return;
  }

  if (cmd === 'timeline.trimToPlayheadRight') {
    if (!focusStore.canUseTimelineHotkeys) return;
    void timelineStore.trimToPlayheadRightNoRipple();
    return;
  }

  if (cmd === 'timeline.rippleTrimLeft') {
    if (!focusStore.canUseTimelineHotkeys) return;
    void timelineStore.rippleTrimLeft();
    return;
  }

  if (cmd === 'timeline.rippleTrimRight') {
    if (!focusStore.canUseTimelineHotkeys) return;
    void timelineStore.rippleTrimRight();
    return;
  }

  if (cmd === 'timeline.advancedRippleTrimLeft') {
    if (!focusStore.canUseTimelineHotkeys) return;
    void timelineStore.advancedRippleTrimLeft();
    return;
  }

  if (cmd === 'timeline.advancedRippleTrimRight') {
    if (!focusStore.canUseTimelineHotkeys) return;
    void timelineStore.advancedRippleTrimRight();
    return;
  }

  if (cmd === 'timeline.jumpPrevBoundary') {
    if (!focusStore.canUseTimelineHotkeys) return;
    timelineStore.jumpToPrevClipBoundary();
    return;
  }

  if (cmd === 'timeline.jumpNextBoundary') {
    if (!focusStore.canUseTimelineHotkeys) return;
    timelineStore.jumpToNextClipBoundary();
    return;
  }

  if (cmd === 'timeline.jumpPrevBoundaryTrack') {
    if (!focusStore.canUseTimelineHotkeys) return;
    timelineStore.jumpToPrevClipBoundary({ currentTrackOnly: true });
    return;
  }

  if (cmd === 'timeline.jumpNextBoundaryTrack') {
    if (!focusStore.canUseTimelineHotkeys) return;
    timelineStore.jumpToNextClipBoundary({ currentTrackOnly: true });
    return;
  }

  if (cmd === 'timeline.splitAtPlayhead') {
    if (!focusStore.canUseTimelineHotkeys) return;
    void timelineStore.splitClipAtPlayhead();
    return;
  }

  if (cmd === 'timeline.splitAllAtPlayhead') {
    if (!focusStore.canUseTimelineHotkeys) return;
    void timelineStore.splitAllClipsAtPlayhead();
    return;
  }

  if (cmd === 'timeline.zoomIn') {
    if (!focusStore.canUseTimelineHotkeys) return;
    startZoomHotkeyHold({ step: 3, keyCode: e.code });
    return;
  }

  if (cmd === 'timeline.zoomOut') {
    if (!focusStore.canUseTimelineHotkeys) return;
    startZoomHotkeyHold({ step: -3, keyCode: e.code });
    return;
  }

  if (cmd === 'timeline.zoomReset') {
    if (!focusStore.canUseTimelineHotkeys) return;
    timelineStore.setTimelineZoom(50);
    return;
  }

  if (cmd === 'timeline.toggleDisableClip') {
    if (!focusStore.canUseTimelineHotkeys) return;
    void timelineStore.toggleDisableTargetClip();
    return;
  }

  if (cmd === 'timeline.toggleMuteClip') {
    if (!focusStore.canUseTimelineHotkeys) return;
    void timelineStore.toggleMuteTargetClip();
    return;
  }

  // --- Timeline Tabs ---
  if (cmd.startsWith('timeline.tab')) {
    const tabIndexStr = cmd.replace('timeline.tab', '');
    const tabIndex = parseInt(tabIndexStr, 10);
    if (!isNaN(tabIndex)) {
      const openPaths = projectStore.projectSettings.timelines.openPaths;
      if (tabIndex > 0 && tabIndex <= openPaths.length) {
        const path = openPaths[tabIndex - 1];
        if (path) {
          projectStore.openTimelineFile(path);
        }
      }
    }
    return;
  }

  // --- Playback ---
  if (cmd === 'playback.toggle') {
    if (timelineStore.isPlaying) {
      timelineStore.togglePlayback();
    } else {
      timelineStore.setPlaybackSpeed(1);
      timelineStore.togglePlayback();
    }
    return;
  }

  if (cmd === 'playback.toStart') {
    if (!focusStore.canUsePlaybackHotkeys) return;
    timelineStore.goToStart();
    return;
  }

  if (cmd === 'playback.toEnd') {
    if (!focusStore.canUsePlaybackHotkeys) return;
    timelineStore.goToEnd();
    return;
  }

  if (cmd === 'general.mute') {
    timelineStore.toggleAudioMuted();
    return;
  }

  if (cmd === 'general.volumeUp') {
    startVolumeHotkeyHold({ step: 0.05, keyCode: e.code });
    return;
  }

  if (cmd === 'general.volumeDown') {
    startVolumeHotkeyHold({ step: -0.05, keyCode: e.code });
    return;
  }

  if (cmd === 'timeline.toggleVisibilityTrack') {
    if (!focusStore.canUseTimelineHotkeys) return;
    void timelineStore.toggleVisibilityTargetTrack();
    return;
  }

  if (cmd === 'timeline.toggleMuteTrack') {
    if (!focusStore.canUseTimelineHotkeys) return;
    void timelineStore.toggleMuteTargetTrack();
    return;
  }

  if (cmd === 'timeline.toggleSoloTrack') {
    if (!focusStore.canUseTimelineHotkeys) return;
    void timelineStore.toggleSoloTargetTrack();
    return;
  }

  const playbackSpeedMatch = cmd.match(/^playback\.(forward|backward)([\d_]+)$/);
}

function onGlobalKeyup(e: KeyboardEvent) {
  if (suppressedKeyupCodes.has(e.code)) {
    e.preventDefault();
    e.stopPropagation();
    (e as any).stopImmediatePropagation?.();
    suppressedKeyupCodes.delete(e.code);
  }

  if (volumeHoldKeyCode && e.code === volumeHoldKeyCode) {
    clearVolumeHoldTimers();
  }
  if (zoomHoldKeyCode && e.code === zoomHoldKeyCode) {
    clearZoomHoldTimers();
  }
}

function onGlobalBlur() {
  suppressedKeyupCodes.clear();
  clearVolumeHoldTimers();
  clearZoomHoldTimers();
}

onMounted(() => {
  window.addEventListener('keydown', onGlobalKeydown, true);
  window.addEventListener('keyup', onGlobalKeyup, true);
  window.addEventListener('blur', onGlobalBlur);
});

onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKeydown, true);
  window.removeEventListener('keyup', onGlobalKeyup, true);
  window.removeEventListener('blur', onGlobalBlur);
  clearVolumeHoldTimers();
  clearZoomHoldTimers();
});

useHead({
  title: t('navigation.granVideoEditor'),
});

const mainSplitSizes = useLocalStorage<number[]>('gran-editor-main-split-v4', [40, 60]);
const topSplitSizes = useLocalStorage<number[]>('gran-editor-top-split-v4', [20, 60, 20]);

function onMainSplitResize(event: { panes: { size: number }[] }) {
  if (Array.isArray(event?.panes)) {
    mainSplitSizes.value = event.panes.map((p) => p.size);
  }
}

function onTopSplitResize(event: { panes: { size: number }[] }) {
  if (Array.isArray(event?.panes)) {
    topSplitSizes.value = event.panes.map((p) => p.size);
  }
}

const newProjectName = ref('');
const isStartingUp = ref(true);

watch(currentTimelinePath, async (newPath) => {
  if (newPath && projectStore.currentProjectName) {
    focusStore.setActiveTimelinePath(newPath);
    await timelineStore.loadTimeline();
    void timelineStore.loadTimelineMetadata();
  }
});

onMounted(async () => {
  try {
    await workspaceStore.init();

    if (
      workspaceStore.workspaceHandle &&
      workspaceStore.userSettings.openLastProjectOnStart &&
      workspaceStore.lastProjectName &&
      workspaceStore.projects.includes(workspaceStore.lastProjectName)
    ) {
      await projectStore.openProject(workspaceStore.lastProjectName);
      uiStore.restoreFileTreeStateOnce(workspaceStore.lastProjectName);
      // Timeline will be loaded by watcher on currentTimelinePath change
    }
  } finally {
    isStartingUp.value = false;
  }
});

async function createNewProject() {
  if (!newProjectName.value.trim()) return;
  await projectStore.createProject(newProjectName.value.trim());
  if (workspaceStore.userSettings.openLastProjectOnStart) {
    await projectStore.openProject(newProjectName.value.trim());
    // Timeline will be loaded by watcher
  }
  newProjectName.value = '';
}

function leaveProject() {
  timelineStore.resetTimelineState();
  mediaStore.resetMediaState();
  projectStore.closeProject();
}
</script>

<template>
  <div
    class="flex flex-col h-screen w-screen overflow-hidden bg-ui-bg text-ui-text"
    @dragover.prevent="onGlobalDragOver"
    @dragleave.prevent="onGlobalDragLeave"
    @drop.prevent="onGlobalDrop"
  >
    <!-- Loading Screen -->
    <div v-if="isStartingUp" class="flex flex-col items-center justify-center flex-1 bg-ui-bg">
      <UIcon
        name="i-heroicons-arrow-path"
        class="w-10 h-10 text-primary-500 shrink-0 animate-spin"
      />
      <span class="mt-4 text-ui-text-muted font-medium tracking-wide animate-pulse">
        {{ t('common.loading', 'Loading...') }}
      </span>
    </div>

    <!-- Welcome / Select Folder Screen -->
    <div
      v-else-if="!workspaceStore.workspaceHandle"
      class="flex flex-col items-center justify-center flex-1 bg-linear-to-br from-primary-950 via-ui-bg-elevated to-black p-6"
    >
      <div
        class="max-w-md w-full text-center space-y-6 bg-ui-bg-elevated/50 p-8 rounded-2xl backdrop-blur-sm border border-ui-border/50 shadow-2xl"
      >
        <div
          class="mx-auto w-16 h-16 bg-primary-500/20 rounded-full flex items-center justify-center mb-6"
        >
          <UIcon name="i-heroicons-film" class="w-8 h-8 text-primary-400" />
        </div>

        <h1
          class="text-3xl font-bold bg-clip-text text-transparent bg-linear-to-r from-primary-300 to-primary-200"
        >
          Gran Video Editor
        </h1>

        <p class="text-ui-text-muted">
          {{
            t(
              'granVideoEditor.welcome.selectFolder',
              'Select a workspace folder on your computer. This folder will store all your project files, media proxies, and cache.',
            )
          }}
        </p>

        <div
          v-if="workspaceStore.error"
          class="text-error-400 text-sm bg-error-400/10 p-3 rounded-lg border border-error-400/20"
        >
          {{ workspaceStore.error }}
        </div>

        <UButton
          v-if="workspaceStore.isApiSupported"
          size="lg"
          variant="solid"
          color="primary"
          icon="i-heroicons-folder-open"
          class="w-full justify-center transition-all hover:scale-[1.02]"
          :label="t('granVideoEditor.welcome.openWorkspace', 'Select Workspace Folder')"
          :loading="workspaceStore.isLoading"
          @click="workspaceStore.openWorkspace"
        />
        <div v-else class="text-orange-400 text-sm">
          {{
            t(
              'granVideoEditor.fileManager.unsupported',
              'File System Access API is not supported in this browser',
            )
          }}
        </div>
      </div>
    </div>

    <!-- Projects List Screen -->
    <div
      v-else-if="!projectStore.currentProjectName"
      class="flex flex-col flex-1 bg-ui-bg p-8 overflow-y-auto"
    >
      <div class="max-w-5xl w-full mx-auto space-y-8 pb-12">
        <div class="flex items-center justify-between">
          <div>
            <h1 class="text-2xl font-bold text-ui-text">
              {{ t('granVideoEditor.projects.title', 'Projects') }}
            </h1>
            <p class="text-ui-text-muted text-sm mt-1">
              Workspace: {{ workspaceStore.workspaceHandle?.name }}
            </p>
          </div>
          <UButton
            size="sm"
            variant="ghost"
            color="neutral"
            icon="i-heroicons-arrow-left-on-rectangle"
            :label="t('granVideoEditor.projects.changeWorkspace', 'Change Workspace')"
            @click="workspaceStore.resetWorkspace"
          />
        </div>

        <div v-if="workspaceStore.error" class="text-error-400 text-sm">
          {{ workspaceStore.error }}
        </div>

        <!-- Last Project Hero Section -->
        <div
          v-if="
            workspaceStore.lastProjectName &&
            workspaceStore.projects.includes(workspaceStore.lastProjectName)
          "
          class="bg-linear-to-r from-primary-950/80 to-primary-900/40 border border-primary-500/30 rounded-2xl p-8 flex flex-col md:flex-row items-center justify-between gap-6"
        >
          <div class="space-y-2">
            <span class="text-primary-400 text-xs font-bold uppercase tracking-widest">
              {{ t('granVideoEditor.projects.continueWorking', 'Continue Working') }}
            </span>
            <h2 class="text-3xl font-bold text-ui-text">{{ workspaceStore.lastProjectName }}</h2>
          </div>
          <UButton
            size="xl"
            color="primary"
            class="px-8 shadow-lg shadow-primary-500/20"
            icon="i-heroicons-play"
            :label="t('granVideoEditor.projects.openLast', 'Open Project')"
            @click="
              async () => {
                if (workspaceStore.lastProjectName) {
                  leaveProject();
                  await projectStore.openProject(workspaceStore.lastProjectName);
                  uiStore.restoreFileTreeStateOnce(workspaceStore.lastProjectName);
                  await timelineStore.loadTimeline();
                  void timelineStore.loadTimelineMetadata();
                }
              }
            "
          />
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          <!-- Create New Project Card -->
          <div
            class="bg-ui-bg-elevated border border-ui-border rounded-xl p-6 flex flex-col gap-4 shadow-xl"
          >
            <h3 class="font-medium text-ui-text">
              {{ t('granVideoEditor.projects.newProject', 'New Project') }}
            </h3>
            <UInput
              v-model="newProjectName"
              :placeholder="t('granVideoEditor.projects.projectNamePlaceholder', 'Project Name')"
              @keyup.enter="createNewProject"
            />
            <UButton
              color="primary"
              variant="soft"
              class="justify-center mt-auto"
              :loading="workspaceStore.isLoading"
              :disabled="!newProjectName.trim()"
              :label="t('common.create', 'Create')"
              @click="createNewProject"
            />
          </div>

          <!-- Existing Projects -->
          <div
            v-for="project in workspaceStore.projects"
            :key="project"
            class="bg-ui-bg-elevated border border-ui-border rounded-xl p-6 flex flex-col hover:border-primary-500/50 hover:bg-ui-bg-accent transition-all cursor-pointer group shadow-lg"
            @click="
              async () => {
                leaveProject();
                await projectStore.openProject(project);
                uiStore.restoreFileTreeStateOnce(project);
                await timelineStore.loadTimeline();
                void timelineStore.loadTimelineMetadata();
              }
            "
          >
            <div class="flex items-center gap-3 mb-4">
              <div
                class="w-10 h-10 rounded-lg bg-ui-bg-accent flex items-center justify-center group-hover:bg-primary-500/10 transition-colors"
              >
                <UIcon
                  name="i-heroicons-film"
                  class="w-5 h-5 text-ui-text-muted group-hover:text-primary-400 transition-colors"
                />
              </div>
              <h3
                class="font-medium text-ui-text truncate group-hover:text-primary-300 transition-colors"
              >
                {{ project }}
              </h3>
            </div>
            <div class="mt-auto flex justify-end">
              <UButton
                size="sm"
                variant="ghost"
                color="primary"
                icon="i-heroicons-arrow-right"
                class="opacity-0 group-hover:opacity-100 transition-all translate-x-1 group-hover:translate-x-0"
                :label="t('common.open', 'Open')"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Editor Screen -->
    <template v-else>
      <div
        class="flex items-center justify-between px-4 py-2.5 bg-ui-bg-elevated border-b border-ui-border"
      >
        <div class="flex items-center gap-2 h-full flex-1 min-w-0">
          <UButton
            size="sm"
            variant="ghost"
            color="neutral"
            icon="i-heroicons-arrow-left"
            class="shrink-0"
            @click="leaveProject"
          />

          <div
            class="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-ui-bg-accent cursor-pointer transition-colors shrink-0"
            @click="isProjectSettingsOpen = true"
          >
            <span class="text-ui-text font-bold text-sm truncate max-w-[200px]">
              {{ projectStore.currentProjectName }}
            </span>
            <UIcon name="i-heroicons-pencil-square-20-solid" class="w-4 h-4 text-ui-text-muted" />
          </div>

          <!-- Timeline Tabs relocated from bottom -->
          <TimelineTabs />
        </div>

        <div class="flex items-center gap-2">
          <UButton
            size="sm"
            variant="ghost"
            color="neutral"
            icon="i-heroicons-arrow-uturn-left"
            :disabled="!timelineStore.historyStore.canUndo"
            :title="t('common.undo') + ' (Ctrl+Z)'"
            @click="timelineStore.undoTimeline()"
          />
          <UButton
            size="sm"
            variant="ghost"
            color="neutral"
            icon="i-heroicons-arrow-uturn-right"
            :disabled="!timelineStore.historyStore.canRedo"
            :title="t('common.redo') + ' (Ctrl+Shift+Z)'"
            @click="timelineStore.redoTimeline()"
          />

          <div class="w-px h-4 bg-ui-border mx-1" />

          <UButton
            size="sm"
            variant="ghost"
            color="neutral"
            icon="i-heroicons-cog-6-tooth"
            :title="t('videoEditor.settings.title', 'Editor settings')"
            @click="isEditorSettingsOpen = true"
          />
          <UButton
            size="sm"
            variant="soft"
            color="primary"
            icon="i-heroicons-arrow-down-tray"
            :disabled="timelineStore.duration <= 0"
            :label="t('videoEditor.export.confirm', 'Export')"
            @click="isExportModalOpen = true"
          />
        </div>
      </div>

      <ClientOnly>
        <Splitpanes
          class="flex-1 min-h-0 editor-splitpanes"
          horizontal
          @resized="onMainSplitResize"
        >
          <Pane :size="mainSplitSizes[0]" min-size="10">
            <Splitpanes class="editor-splitpanes" @resized="onTopSplitResize">
              <Pane :size="topSplitSizes[0]" min-size="5">
                <FileManager class="h-full" />
              </Pane>
              <Pane :size="topSplitSizes[1]" min-size="10">
                <Monitor class="h-full" />
              </Pane>
              <Pane :size="topSplitSizes[2]" min-size="5">
                <PropertiesPanel class="h-full" />
              </Pane>
            </Splitpanes>
          </Pane>
          <Pane :size="mainSplitSizes[1]" min-size="10">
            <Timeline class="h-full" />
          </Pane>
        </Splitpanes>
      </ClientOnly>

      <TimelineExportModal v-model:open="isExportModalOpen" @exported="() => {}" />

      <EditorSettingsModal v-model:open="isEditorSettingsOpen" />

      <ProjectSettingsModal v-model:open="isProjectSettingsOpen" />

      <div
        v-if="uiStore.isGlobalDragging && !uiStore.isFileManagerDragging"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs transition-opacity pointer-events-none"
      >
        <div
          class="flex flex-col items-center justify-center p-12 bg-ui-bg-elevated/90 border border-primary-500/50 rounded-3xl shadow-2xl animate-pulse-slow"
        >
          <UIcon name="i-heroicons-arrow-down-tray" class="w-20 h-20 text-primary-500 mb-6" />
          <h2 class="text-3xl font-bold text-white mb-2 text-center">
            {{ t('videoEditor.fileManager.actions.dropFilesHere', 'Drop files here') }}
          </h2>
          <div class="space-y-4 text-center max-w-md">
            <p class="text-lg text-ui-text-muted">
              {{
                t(
                  'videoEditor.fileManager.actions.dropFilesGlobalDescription',
                  'Release files to automatically save them to the project sources folder',
                )
              }}
            </p>
            <div
              class="flex items-center justify-center gap-2 py-2 px-4 bg-primary-500/10 rounded-xl border border-primary-400/20"
            >
              <UIcon name="i-heroicons-folder" class="w-5 h-5 text-primary-400" />
              <p class="text-sm font-medium text-primary-400">
                {{
                  t(
                    'videoEditor.fileManager.actions.dropToFolderHint',
                    'Drag to the File Manager on the left to upload to a specific folder',
                  )
                }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style>
/* Custom theme for splitpanes matching Gran Video Editor dark mode */
.editor-splitpanes {
  background-color: transparent;
}
.editor-splitpanes .splitpanes__pane {
  background-color: transparent;
}
.editor-splitpanes > .splitpanes__splitter {
  background-color: var(--color-ui-border);
  position: relative;
  box-sizing: border-box;
}
.editor-splitpanes > .splitpanes__splitter:before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  transition: background-color 0.2s;
  background-color: transparent;
  z-index: 10;
}
.editor-splitpanes > .splitpanes__splitter:hover:before {
  background-color: var(--color-primary-500);
}
.editor-splitpanes.splitpanes--vertical > .splitpanes__splitter {
  width: 2px;
  cursor: col-resize;
}
.editor-splitpanes.splitpanes--vertical > .splitpanes__splitter:before {
  left: -3px;
  right: -3px;
  height: 100%;
}
.editor-splitpanes.splitpanes--horizontal > .splitpanes__splitter {
  height: 2px;
  cursor: row-resize;
}
.editor-splitpanes.splitpanes--horizontal > .splitpanes__splitter:before {
  top: -3px;
  bottom: -3px;
  width: 100%;
}
</style>
