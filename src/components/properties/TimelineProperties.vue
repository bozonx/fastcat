<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useUiStore } from '~/stores/ui.store';
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyRow from '~/components/properties/PropertyRow.vue';
import EntryActions from '~/components/properties/file/EntryActions.vue';
import UiWheelSlider from '~/components/ui/UiWheelSlider.vue';
import EffectsEditor from '~/components/common/EffectsEditor.vue';
import AudioEffectsEditor from '~/components/common/AudioEffectsEditor.vue';
import type { VideoClipEffect, AudioClipEffect } from '~/timeline/types';
import type { FsEntry } from '~/types/fs';
import {
  DEFAULT_TIMELINE_ZOOM_POSITION,
  formatZoomMultiplier,
  MAX_TIMELINE_ZOOM_POSITION,
  MIN_TIMELINE_ZOOM_POSITION,
  TIMELINE_ZOOM_POSITIONS,
  timelineZoomPositionToScale,
} from '~/utils/zoom';
import { formatDurationSeconds } from '~/utils/format';
import { selectTimelineDurationUs } from '~/timeline/selectors';
import { useFilePropertiesHandlers } from '~/composables/properties/useFilePropertiesHandlers';

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
const uiStore = useUiStore();

const fsEntryRef = computed(() => props.fsEntry ?? null);
const mediaTypeRef = computed(() => null as string | null | undefined);
const textContentRef = computed(() => null as string | null | undefined);
const canUploadToRemoteRef = computed(() => false);

const { onRename, onDelete } = useFilePropertiesHandlers({
  selectedFsEntry: fsEntryRef,
  mediaType: mediaTypeRef,
  textContent: textContentRef,
  canUploadToRemote: canUploadToRemoteRef,
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
  const doc = timelineStore.timelineDoc;
  if (!doc) return null;
  const videoTracks = doc.tracks.filter((tr) => tr.kind === 'video').length;
  const audioTracks = doc.tracks.filter((tr) => tr.kind === 'audio').length;
  const clips = doc.tracks.reduce(
    (acc, tr) => acc + tr.items.filter((i) => i.kind === 'clip').length,
    0,
  );
  const durationUs = selectTimelineDurationUs(doc);
  return {
    version: '-',
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
    timelineStore.setTimelineZoomExact(DEFAULT_TIMELINE_ZOOM_POSITION + 7 * Math.log2(parsed));
  },
});

function handleUpdateMasterEffects(effects: VideoClipEffect[]) {
  timelineStore.applyTimeline({
    type: 'update_master_effects',
    effects: [...effects, ...masterAudioEffects.value] as any,
  });
}

function handleUpdateMasterAudioEffects(effects: AudioClipEffect[]) {
  timelineStore.applyTimeline({
    type: 'update_master_effects',
    effects: [...masterEffects.value, ...effects] as any,
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
</script>

<template>
  <div class="w-full flex flex-col gap-3">
    <!-- Info Section -->
    <PropertySection :title="t('common.info', 'Info')" v-if="computedSummary">
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

    <!-- File actions (rename, delete, create version) when opened from file manager -->
    <PropertySection
      v-if="fileActions"
      :title="t('videoEditor.fileManager.actions.title', 'Actions')"
    >
      <EntryActions
        :primary-actions="fileActions.primary"
        :secondary-actions="fileActions.secondary"
      />
    </PropertySection>

    <!-- Timeline actions (add track) -->
    <PropertySection :title="t('fastcat.timeline.properties.actions', 'Actions')" v-if="!isReadOnly">
      <div class="grid grid-cols-2 gap-2 w-full mt-1">
        <UButton
          size="xs"
          variant="soft"
          color="neutral"
          icon="i-heroicons-video-camera"
          class="justify-start"
          @click="handleAddVideoTrack"
        >
          {{ t('fastcat.timeline.addVideoTrack', 'Add video track') }}
        </UButton>
        <UButton
          size="xs"
          variant="soft"
          color="neutral"
          icon="i-heroicons-musical-note"
          class="justify-start"
          @click="handleAddAudioTrack"
        >
          {{ t('fastcat.timeline.addAudioTrack', 'Add audio track') }}
        </UButton>
      </div>
    </PropertySection>

    <!-- Settings -->
    <PropertySection :title="t('common.settings', 'Settings')" v-if="!isReadOnly">
      <div class="flex flex-col">
        <PropertyRow :label="t('fastcat.timeline.properties.zoom', 'Zoom')">
          <div class="flex items-center gap-2">
            <div class="min-w-0 flex-1">
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
              <UInput v-model="timelineZoomMultiplierInput" size="xs" class="w-full font-mono text-center" />
            </div>
          </div>
        </PropertyRow>

        <PropertyRow :label="t('videoEditor.hotkeys.general.mute', 'Mute')">
          <div class="flex justify-end w-full">
            <USwitch
              size="sm"
              :model-value="masterMuted"
              @update:model-value="masterMuted = $event"
            />
          </div>
        </PropertyRow>
      </div>
    </PropertySection>

    <!-- Master Video Effects -->
    <div class="relative" v-if="!isReadOnly">
      <EffectsEditor
        :effects="masterEffects"
        :title="t('fastcat.effects.masterTitle', 'Master effects')"
        @update:effects="handleUpdateMasterEffects"
      />
      <div
        v-if="masterEffects.length === 0"
        class="absolute inset-0 flex items-center justify-center pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <div class="text-[10px] text-primary-400 font-medium uppercase tracking-wider">
          {{ t('fastcat.effects.dropHint', 'Drop effect here') }}
        </div>
      </div>
    </div>

    <AudioEffectsEditor
      v-if="!isReadOnly"
      :effects="masterAudioEffects"
      @update:effects="handleUpdateMasterAudioEffects"
    />

    <!-- Master Volume -->
    <PropertySection :title="t('fastcat.timeline.properties.masterVolume', 'Master Volume')" v-if="!isReadOnly">
      <div class="flex flex-col">
        <PropertyRow :label="masterGain.toFixed(3) + 'x'">
          <UiWheelSlider
            v-model="masterGain"
            :min="0"
            :max="2"
            :step="0.001"
            :wheel-step-multiplier="10"
            :default-value="1"
          />
        </PropertyRow>
      </div>
    </PropertySection>
  </div>
</template>
