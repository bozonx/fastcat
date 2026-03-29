<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useUiStore } from '~/stores/ui.store';
import { useMediaStore } from '~/stores/media.store';
import { useProxyStore } from '~/stores/proxy.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { useEntryPreview } from '~/composables/file-manager/useEntryPreview';
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyRow from '~/components/properties/PropertyRow.vue';
import EntryActions from '~/components/properties/file/EntryActions.vue';
import UiWheelSlider from '~/components/ui/UiWheelSlider.vue';
import UiSliderInput from '~/components/ui/UiSliderInput.vue';
import EffectsEditor from '~/components/effects/EffectsEditor.vue';
import AudioEffectsEditor from '~/components/effects/AudioEffectsEditor.vue';
import PropertyActionList from '~/components/properties/PropertyActionList.vue';
import type { VideoClipEffect, AudioClipEffect } from '~/timeline/types';
import type { FsEntry } from '~/types/fs';
import {
  DEFAULT_TIMELINE_ZOOM_POSITION,
  formatZoomMultiplier,
  MAX_TIMELINE_ZOOM_POSITION,
  MIN_TIMELINE_ZOOM_POSITION,
  TIMELINE_ZOOM_POSITIONS,
  timelineZoomPositionToScale,
  timelineZoomScaleToPosition,
} from '~/utils/zoom';
import { formatDurationSeconds, formatBytes } from '~/utils/format';
import { selectTimelineDurationUs } from '~/timeline/selectors';
import EntryPreviewBox from '~/components/properties/file/EntryPreviewBox.vue';
import FileGeneralInfoSection from '~/components/properties/file/FileGeneralInfoSection.vue';
import { useFilePropertiesBasics } from '~/composables/properties/useFilePropertiesBasics';

import { useFilePropertiesHandlers } from '~/composables/properties/useFilePropertiesHandlers';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import { useFileTimelineUsage } from '~/composables/properties/useFileTimelineUsage';
import FileTimelineUsageSection from '~/components/properties/file/FileTimelineUsageSection.vue';

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

const fsEntryRef = computed(() => props.fsEntry ?? null);

const { timelineDocSummary, fileInfo, currentUrl, isUnknown, mediaType, textContent } =
  useEntryPreview({
    selectedFsEntry: fsEntryRef,
    previewMode: ref('original'),
    hasProxy: ref(false),
    mediaStore,
    proxyStore,
    getFileByPath: (path) => fileManager.vfs.getFile(path),
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

const finalIsReadOnly = computed(() => props.isReadOnly || isInactiveTimeline.value);

const { onRename, onDelete } = useFilePropertiesHandlers({
  selectedFsEntry: fsEntryRef,
  mediaType: mediaType,
  textContent: textContent,
  canUploadToRemote: ref(false),
});

const timelineMediaUsageStore = useTimelineMediaUsageStore();
const { timelinesUsingSelectedFile, openTimelineFromUsage } = useFileTimelineUsage({
  selectedFsEntry: fsEntryRef,
  timelineMediaUsageStore,
  projectStore,
  timelineStore,
});

const fileActions = computed(() => {
  if (!props.fsEntry) return null;
  return {
    primary: [
      {
        id: 'rename',
        title: t('common.rename', 'Rename'),
        icon: 'i-heroicons-pencil',
        onClick: onRename,
      },
      {
        id: 'delete',
        title: t('common.delete', 'Delete'),
        icon: 'i-heroicons-trash',
        onClick: onDelete,
      },
    ],
    secondary: [
      {
        id: 'createOtioVersion',
        label: t('fastcat.timeline.createVersion', 'Create version'),
        icon: 'i-heroicons-document-duplicate',
        onClick: () => {
          uiStore.pendingOtioCreateVersion = props.fsEntry!;
        },
      },
    ],
  };
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

const masterMuted = computed({
  get: () => Boolean(timelineStore.timelineDoc?.metadata?.fastcat?.masterMuted),
  set: (muted: boolean) => {
    timelineStore.setMasterMuted(muted);
  },
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
    label: t('fastcat.timeline.addVideoTrack', 'Add video track'),
    icon: 'i-heroicons-video-camera',
    onClick: handleAddVideoTrack,
  },
  {
    id: 'add-audio',
    label: t('fastcat.timeline.addAudioTrack', 'Add audio track'),
    icon: 'i-heroicons-musical-note',
    onClick: handleAddAudioTrack,
  },
]);
</script>

<template>
  <div class="w-full flex flex-col gap-3">
    <!-- Actions (merge file and timeline actions) -->
    <PropertySection
      v-if="fileActions || !finalIsReadOnly"
      :title="t('videoEditor.fileManager.actions.title', 'Actions')"
    >
      <div class="flex flex-col gap-2">
        <EntryActions
          v-if="fileActions"
          :primary-actions="fileActions.primary"
          :secondary-actions="fileActions.secondary"
        />
        <div
          v-if="!finalIsReadOnly"
          :class="{ 'mt-1 pt-1 border-t border-ui-border/50': fileActions }"
        >
          <PropertyActionList
            :actions="addTrackActions"
            :vertical="false"
            justify="start"
            size="xs"
          />
        </div>
      </div>
    </PropertySection>

    <!-- Info Section -->
    <PropertySection v-if="computedSummary" :title="t('common.info', 'Info')">
      <div class="flex flex-col">
        <PropertyRow
          :label="t('fastcat.timeline.version', 'Version')"
          :value="computedSummary.version ?? '-'"
        />
        <PropertyRow
          :label="t('common.duration', 'Duration')"
          :value="formatDurationSeconds((computedSummary.durationUs ?? 0) / 1_000_000)"
        />
        <PropertyRow
          :label="t('videoEditor.fileManager.otio.videoTracks', 'Video tracks')"
          :value="computedSummary.videoTracks ?? '-'"
        />
        <PropertyRow
          :label="t('videoEditor.fileManager.otio.audioTracks', 'Audio tracks')"
          :value="computedSummary.audioTracks ?? '-'"
        />
        <PropertyRow
          :label="t('videoEditor.fileManager.otio.clips', 'Clips')"
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

    <!-- Settings (No title, includes Master Volume) -->
    <PropertySection v-if="!finalIsReadOnly">
      <div class="flex flex-col gap-3 py-1">
        <PropertyRow :label="t('videoEditor.hotkeys.general.mute', 'Mute')">
          <div class="flex justify-end w-full">
            <USwitch
              size="sm"
              :model-value="masterMuted"
              @update:model-value="masterMuted = $event"
            />
          </div>
        </PropertyRow>

        <div class="h-px bg-ui-border opacity-30 my-0.5" />

        <UiSliderInput
          v-model="masterGain"
          :label="t('fastcat.track.audio.volume', 'Volume')"
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
          {{ t('fastcat.effects.dropHint', 'Drop effect here') }}
        </div>
      </div>
    </div>

    <AudioEffectsEditor
      v-if="!finalIsReadOnly"
      :effects="masterAudioEffects"
      @update:effects="handleUpdateMasterAudioEffects"
    />
  </div>
</template>
