<script setup lang="ts">
import { computed } from 'vue';
import MobileTimelineDrawer from './MobileTimelineDrawer.vue';
import PropertyRow from '~/components/properties/PropertyRow.vue';
import UiSliderInput from '~/components/ui/UiSliderInput.vue';
import EffectsEditor from '~/components/effects/EffectsEditor.vue';
import AudioEffectsEditor from '~/components/effects/AudioEffectsEditor.vue';
import PropertyActionList from '~/components/properties/PropertyActionList.vue';
import MediaResolutionSettings from '~/components/media/MediaResolutionSettings.vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { selectTimelineDurationUs } from '~/timeline/selectors';
import { formatDurationSeconds } from '~/utils/format';
import type { VideoClipEffect, AudioClipEffect } from '~/timeline/types';
import type { TimelineFormatInput } from '~/timeline/format';

const props = defineProps<{
  isOpen: boolean;
}>();

const activeSnapPoint = defineModel<string | number | null>('activeSnapPoint', { default: null });

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();

const isOpenLocal = computed({
  get: () => props.isOpen,
  set: (val) => {
    if (!val) emit('close');
  },
});

const summary = computed(() => {
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

async function handleDuplicate() {
  await timelineStore.duplicateCurrentTimeline();
  emit('close');
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

const timelineActions = computed(() => [
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
  {
    id: 'create-version',
    label: t('fastcat.timeline.createVersion'),
    icon: 'i-heroicons-document-duplicate',
    onClick: handleDuplicate,
    color: 'primary' as const,
  },
]);
</script>

<template>
  <MobileTimelineDrawer
    v-model:open="isOpenLocal"
    v-model:active-snap-point="activeSnapPoint"
    @update:open="!$event && emit('close')"
  >
    <div class="px-4 pb-8 flex flex-col gap-6 pt-2">
      <div class="flex items-center gap-2">
        <div class="text-ui-text font-bold text-xl">{{ t('videoEditor.timeline.settings') }}</div>
      </div>

      <!-- Actions Section -->
      <div class="py-1 px-3 border border-ui-border rounded-xl bg-zinc-900/40">
        <PropertyActionList :actions="timelineActions" vertical variant="ghost" size="md" />
      </div>

      <!-- Info Section -->
      <div
        v-if="summary"
        class="flex flex-col gap-1 rounded-2xl bg-ui-bg p-4 border border-ui-border"
      >
        <div class="text-xs font-bold text-ui-text-muted uppercase tracking-widest mb-2">
          {{ t('common.info') }}
        </div>
        <PropertyRow :label="t('fastcat.timeline.version')" :value="summary.version" />
        <div class="h-px bg-ui-border/50 my-1" />
        <PropertyRow
          :label="t('common.duration')"
          :value="formatDurationSeconds((summary.durationUs ?? 0) / 1_000_000)"
        />
        <div class="h-px bg-ui-border/50 my-1" />
        <PropertyRow
          :label="t('videoEditor.fileManager.otio.videoTracks')"
          :value="summary.videoTracks"
        />
        <div class="h-px bg-ui-border/50 my-1" />
        <PropertyRow
          :label="t('videoEditor.fileManager.otio.audioTracks')"
          :value="summary.audioTracks"
        />
        <div class="h-px bg-ui-border/50 my-1" />
        <PropertyRow :label="t('videoEditor.fileManager.otio.clips')" :value="summary.clips" />
      </div>

      <div class="flex flex-col gap-3 rounded-2xl bg-ui-bg p-4 border border-ui-border">
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
      </div>

      <!-- Master Volume -->
      <div class="flex flex-col gap-3 rounded-2xl bg-ui-bg p-4 border border-ui-border">
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

      <!-- Master Video Effects -->
      <div class="flex flex-col gap-2">
        <EffectsEditor
          :effects="masterEffects"
          :title="`${t('fastcat.effects.tabs.video')} ${t('fastcat.effects.title').toLowerCase()}`"
          @update:effects="handleUpdateMasterEffects"
        />

        <AudioEffectsEditor
          :effects="masterAudioEffects"
          @update:effects="handleUpdateMasterAudioEffects"
        />
      </div>
    </div>
  </MobileTimelineDrawer>
</template>
