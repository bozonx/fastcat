<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useUiStore } from '~/stores/ui.store';
import { useMediaStore } from '~/stores/media.store';
import { useProxyStore } from '~/stores/proxy.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { useEntryPreview } from '~/composables/file-manager/useEntryPreview';
import { revealFileManagerEntry } from '~/composables/file-manager/revealFileManagerEntry';
import { normalizeWorkspaceFilePath } from '~/utils/workspace-common';
import { useSelectionStore } from '~/stores/selection.store';
import { useFocusStore } from '~/stores/focus.store';
import { useFileManagerStore } from '~/stores/file-manager.store';
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyRow from '~/components/properties/PropertyRow.vue';
import PropertyActionsBlock from '~/components/properties/PropertyActionsBlock.vue';
import UiSliderInput from '~/components/ui/UiSliderInput.vue';
import EffectsEditor from '~/components/effects/EffectsEditor.vue';
import AudioEffectsEditor from '~/components/effects/AudioEffectsEditor.vue';
import UiRenameModal from '~/components/ui/UiRenameModal.vue';
import type { VideoClipEffect, AudioClipEffect } from '~/timeline/types';
import type { FsEntry } from '~/types/fs';
import { formatDurationSeconds, formatBytes } from '~/utils/format';
import { selectTimelineDurationUs } from '~/timeline/selectors';
import FileGeneralInfoSection from '~/components/properties/file/FileGeneralInfoSection.vue';
import { useFilePropertiesBasics } from '~/composables/properties/useFilePropertiesBasics';

import { useFilePropertiesHandlers } from '~/composables/properties/useFilePropertiesHandlers';
import { useProjectStore } from '~/stores/project.store';
import { useProjectTabsStore } from '~/stores/project-tabs.store';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import { useFileTimelineUsage } from '~/composables/properties/useFileTimelineUsage';
import FileTimelineUsageSection from '~/components/properties/file/FileTimelineUsageSection.vue';
import MediaResolutionSettings from '~/components/media/MediaResolutionSettings.vue';
import type { TimelineFormatInput } from '~/timeline/format';

const props = defineProps<{
  summary?: {
    version?: string | number | null;
    durationUs?: number | null;
    videoTracks?: number | null;
    audioTracks?: number | null;
    clips?: number | null;
  };
  isReadOnly?: boolean;
  fsEntry?: FsEntry | null;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();
const projectStore = useProjectStore();
const uiStore = useUiStore();
const mediaStore = useMediaStore();
const proxyStore = useProxyStore();
const fileManager = useFileManager();
const selectionStore = useSelectionStore();
const { setActiveTab } = useProjectTabsStore();
const focusStore = useFocusStore();
const fileManagerStore = useFileManagerStore();

const fsEntryRef = computed(() => props.fsEntry ?? null);

const { timelineDocSummary, fileInfo, mediaType, textContent } = useEntryPreview({
  selectedFsEntry: fsEntryRef,
  previewMode: ref('original'),
  hasProxy: ref(false),
  mediaStore,
  proxyStore,
  getFileByPath: (path) => fileManager.vfs.getFile(path),
  getObjectUrlByPath: (path) => fileManager.vfs.getObjectUrl(path),
  onResetPreviewMode: () => {},
});

const { generalInfoTitle, isHidden, selectedPath } = useFilePropertiesBasics({
  selectedFsEntry: fsEntryRef,
  fileInfo,
  isOtio: ref(true),
  mediaType,
});

const isInactiveTimeline = computed(() => {
  if (!props.fsEntry) return false;
  return props.fsEntry.path !== projectStore.currentTimelinePath;
});

const finalIsReadOnly = computed(
  () => props.isReadOnly || isInactiveTimeline.value || projectStore.isReadOnly || timelineStore.previewMode,
);

const { onDelete } = useFilePropertiesHandlers({
  // onRename is kept for potential future use but not used for the quick-action button anymore

  selectedFsEntry: fsEntryRef,
  mediaType: mediaType,
  textContent: textContent,
});

const timelineMediaUsageStore = useTimelineMediaUsageStore();
const { timelinesUsingSelectedFile, openTimelineFromUsage } = useFileTimelineUsage({
  selectedFsEntry: fsEntryRef,
  timelineMediaUsageStore,
  projectStore,
  timelineStore,
});

const isRenameModalOpen = ref(false);

async function handleRenameConfirm(newName: string) {
  const entry = props.fsEntry;
  if (!entry) return;
  await fileManager.renameEntry(entry, newName.trim());
  isRenameModalOpen.value = false;
}

async function handleSelectInFileManager() {
  const entry = props.fsEntry;
  if (!entry) return;
  await revealFileManagerEntry({
    path: normalizeWorkspaceFilePath(entry.path),
    beforeReveal: async () => {
      if (projectStore.currentView && projectStore.currentView !== 'files') {
        setActiveTab('files');
      }
    },
    loadProjectDirectory: fileManager.loadProjectDirectory,
    notifyFileManagerUpdate: uiStore.notifyFileManagerUpdate,
    findEntryByPath: fileManager.findEntryByPath,
    toggleDirectory: fileManager.toggleDirectory,
    openFolder: fileManagerStore.openFolder,
    setSelectedFsEntry: (e) => {
      uiStore.selectedFsEntry = {
        kind: e.kind,
        name: e.name,
        path: e.path,
        parentPath: e.parentPath,
        lastModified: e.lastModified,
        size: e.size,
        source: e.source,
        remoteId: e.remoteId,
        remotePath: e.remotePath,
        adapterPayload: e.adapterPayload,
      };
    },
    selectEntry: (e) => selectionStore.selectFsEntry(e),
    scrollToEntry: (path) => uiStore.triggerScrollToFileTreeEntry(path),
    focusFileManager: () => focusStore.setTempFocus('files-sidebar'),
  });
}

const timelineQuickActions = computed(() => {
  if (!props.fsEntry) return [];
  return [
    {
      id: 'delete',
      title: t('common.delete'),
      icon: 'i-heroicons-trash',
      onClick: onDelete,
    },
    {
      id: 'rename',
      title: t('common.rename'),
      icon: 'i-heroicons-pencil',
      onClick: () => {
        isRenameModalOpen.value = true;
      },
    },
  ];
});

const timelineAdditionalActions = computed(() => {
  const list = [...addTrackActions.value];
  if (props.fsEntry) {
    list.unshift({
      id: 'showInFileManager',
      label: t('fastcat.clip.showInFileManager'),
      icon: 'i-heroicons-folder-open',
      onClick: handleSelectInFileManager,
    });
    list.unshift({
      id: 'createOtioVersion',
      label: t('fastcat.timeline.createVersion'),
      icon: 'i-heroicons-document-duplicate',
      onClick: () => {
        if (isInactiveTimeline.value) {
          uiStore.pendingOtioCreateVersion = props.fsEntry!;
        } else {
          void timelineStore.duplicateCurrentTimeline();
        }
      },
    });
  }
  return list;
});

const computedSummary = computed(() => {
  if (props.summary) return props.summary;
  if (isInactiveTimeline.value && timelineDocSummary.value) return timelineDocSummary.value;
  const doc = timelineStore.timelineDoc;
  if (!doc) return null;
  const videoTracks = doc.tracks.filter((tr) => tr.kind === 'video').length;
  const audioTracks = doc.tracks.filter((tr) => tr.kind === 'audio').length;
  const clips = doc.tracks.reduce(
    (acc, tr) => acc + tr.items.filter((i) => i.kind === 'clip').length,
    0,
  );
  const version = doc.metadata?.fastcat?.version ?? '-';
  const durationUs = selectTimelineDurationUs(doc);
  return {
    version,
    durationUs,
    videoTracks,
    audioTracks,
    clips,
  };
});

const masterGain = computed({
  get: () => timelineStore.timelineDoc?.metadata?.fastcat?.masterGain ?? 1,
  set: (val: number) => {
    timelineStore.applyTimeline({
      type: 'update_master_gain',
      gain: val,
    });
  },
});

const masterEffects = computed(() =>
  (timelineStore.timelineDoc?.metadata?.fastcat?.masterEffects ?? []).filter(
    (effect): effect is VideoClipEffect => effect?.target !== 'audio',
  ),
);

const masterAudioEffects = computed(() =>
  (timelineStore.timelineDoc?.metadata?.fastcat?.masterEffects ?? []).filter(
    (effect): effect is AudioClipEffect => effect?.target === 'audio',
  ),
);

function updateFormat(patch: TimelineFormatInput) {
  void timelineStore.updateTimelineFormat({
    ...timelineStore.timelineFormat,
    ...patch,
    isAutoSettings: false,
    settingsSource: 'manual',
  });
}

const timelineWidth = computed({
  get: () => timelineStore.timelineFormat.width,
  set: (width: number) => updateFormat({ width }),
});

const timelineHeight = computed({
  get: () => timelineStore.timelineFormat.height,
  set: (height: number) => updateFormat({ height }),
});

const timelineFps = computed({
  get: () => timelineStore.timelineFormat.fps,
  set: (fps: number) => updateFormat({ fps }),
});

const timelineResolutionFormat = computed({
  get: () => timelineStore.timelineFormat.resolutionFormat,
  set: (resolutionFormat: string) => updateFormat({ resolutionFormat }),
});

const timelineOrientation = computed({
  get: () => timelineStore.timelineFormat.orientation,
  set: (orientation: 'landscape' | 'portrait') => updateFormat({ orientation }),
});

const timelineAspectRatio = computed({
  get: () => timelineStore.timelineFormat.aspectRatio,
  set: (aspectRatio: string) => updateFormat({ aspectRatio }),
});

const timelineIsCustomResolution = computed({
  get: () => timelineStore.timelineFormat.isCustomResolution,
  set: (isCustomResolution: boolean) => updateFormat({ isCustomResolution }),
});

const timelineSampleRate = computed({
  get: () => timelineStore.timelineFormat.sampleRate,
  set: (sampleRate: number) => updateFormat({ sampleRate }),
});

function handleUpdateMasterEffects(effects: VideoClipEffect[]) {
  timelineStore.applyTimeline({
    type: 'update_master_effects',
    effects: [...effects, ...masterAudioEffects.value] as (VideoClipEffect | AudioClipEffect)[],
  });
}

function handleUpdateMasterAudioEffects(effects: AudioClipEffect[]) {
  timelineStore.applyTimeline({
    type: 'update_master_effects',
    effects: [...masterEffects.value, ...effects] as (VideoClipEffect | AudioClipEffect)[],
  });
}

function handleAddVideoTrack() {
  const idx =
    (timelineStore.timelineDoc?.tracks.filter((tr) => tr.kind === 'video').length ?? 0) + 1;
  timelineStore.addTrack('video', `Video ${idx}`);
}

function handleAddAudioTrack() {
  const idx =
    (timelineStore.timelineDoc?.tracks.filter((tr) => tr.kind === 'audio').length ?? 0) + 1;
  timelineStore.addTrack('audio', `Audio ${idx}`);
}

const addTrackActions = computed(() => [
  {
    id: 'add-video',
    label: t('fastcat.timeline.addVideoTrack'),
    icon: 'i-heroicons-video-camera',
    onClick: handleAddVideoTrack,
  },
  {
    id: 'add-audio',
    label: t('fastcat.timeline.addAudioTrack'),
    icon: 'i-heroicons-musical-note',
    onClick: handleAddAudioTrack,
  },
]);
</script>

<template>
  <!-- IMPORTANT: NO LOADING INDICATORS ALLOWED HERE. ALL PROPERTIES MUST LOAD SILENTLY. -->
  <div class="w-full flex flex-col gap-3">
    <!-- Actions (merge file and timeline actions) -->
    <PropertySection
      v-if="timelineQuickActions.length > 0 || timelineAdditionalActions.length > 0"
      :title="t('videoEditor.fileManager.actions.title')"
    >
      <PropertyActionsBlock
        :quick-actions="timelineQuickActions"
        :additional-actions="timelineAdditionalActions"
      />
    </PropertySection>

    <!-- Info Section -->
    <PropertySection v-if="computedSummary">
      <div class="flex flex-col">
        <PropertyRow
          :label="t('fastcat.timeline.version')"
          :value="computedSummary.version ?? '-'"
        />
        <PropertyRow
          :label="t('common.duration')"
          :value="formatDurationSeconds((computedSummary.durationUs ?? 0) / 1_000_000)"
        />
        <PropertyRow
          :label="t('videoEditor.fileManager.otio.videoTracks')"
          :value="computedSummary.videoTracks ?? '-'"
        />
        <PropertyRow
          :label="t('videoEditor.fileManager.otio.audioTracks')"
          :value="computedSummary.audioTracks ?? '-'"
        />
        <PropertyRow
          :label="t('videoEditor.fileManager.otio.clips')"
          :value="computedSummary.clips ?? '-'"
        />
      </div>
    </PropertySection>

    <!-- OTIO Section (File Info) -->
    <template v-if="fsEntry">
      <FileGeneralInfoSection
        v-if="fileInfo"
        :title="generalInfoTitle"
        :file-info="fileInfo"
        :selected-path="selectedPath"
        :is-hidden="isHidden"
        :format-bytes="formatBytes"
      />

      <FileTimelineUsageSection
        v-if="timelinesUsingSelectedFile.length > 0"
        :usages="timelinesUsingSelectedFile"
        :open-timeline-from-usage="openTimelineFromUsage"
      />
    </template>

    <PropertySection v-if="!finalIsReadOnly" :title="t('videoEditor.timeline.format')">
      <MediaResolutionSettings
        v-model:width="timelineWidth"
        v-model:height="timelineHeight"
        v-model:fps="timelineFps"
        v-model:resolution-format="timelineResolutionFormat"
        v-model:orientation="timelineOrientation"
        v-model:aspect-ratio="timelineAspectRatio"
        v-model:is-custom-resolution="timelineIsCustomResolution"
        v-model:sample-rate="timelineSampleRate"
      />
    </PropertySection>

    <!-- Settings (No title, includes Master Volume) -->
    <PropertySection v-if="!finalIsReadOnly">
      <div class="flex flex-col gap-3 py-1">
        <UiSliderInput
          v-model="masterGain"
          :label="t('fastcat.timeline.properties.masterVolume')"
          :min="0"
          :max="2"
          :step="0.001"
          :wheel-step-multiplier="10"
          :default-value="1"
          unit="x"
        />
      </div>
    </PropertySection>

    <!-- Master Video Effects -->
    <div v-if="!finalIsReadOnly" class="relative">
      <EffectsEditor
        :effects="masterEffects"
        :title="`${t('fastcat.effects.tabs.video')} ${t('fastcat.effects.title').toLowerCase()}`"
        @update:effects="handleUpdateMasterEffects"
      />
      <div
        v-if="masterEffects.length === 0"
        class="absolute inset-0 flex items-center justify-center pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <div class="text-2xs text-primary-400 font-medium uppercase tracking-wider">
          {{ t('fastcat.effects.dropHint') }}
        </div>
      </div>
    </div>

    <AudioEffectsEditor
      v-if="!finalIsReadOnly"
      :effects="masterAudioEffects"
      @update:effects="handleUpdateMasterAudioEffects"
    />

    <UiRenameModal
      v-if="fsEntry"
      :open="isRenameModalOpen"
      :initial-name="fsEntry.name"
      :current-name="fsEntry.name"
      @update:open="isRenameModalOpen = $event"
      @rename="handleRenameConfirm"
    />
  </div>
</template>
