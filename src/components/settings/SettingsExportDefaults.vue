<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import MediaEncodingSettings, {
  type FormatOption,
} from '~/components/media/MediaEncodingSettings.vue';
import {
  BASE_VIDEO_CODEC_OPTIONS,
  checkVideoCodecSupport,
  resolveVideoCodecOptions,
} from '~/utils/webcodecs';
import { createDefaultExportPresets, createExportPresetId, resolveExportPreset } from '~/utils/settings';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';

const props = defineProps<{
  isActive: boolean;
}>();

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const toast = useToast();

const formatOptions: readonly FormatOption[] = [
  { value: 'mp4', label: 'MP4' },
  { value: 'webm', label: 'WEBM' },
  { value: 'mkv', label: 'MKV (AV1)' },
];

const videoCodecSupport = ref<Record<string, boolean>>({});
const isLoadingCodecSupport = ref(false);


const presetOptions = computed(() =>
  workspaceStore.userSettings.exportPresets.items.map((preset) => ({
    value: preset.id,
    label: preset.name,
  })),
);

const selectedPreset = computed(() => resolveExportPreset(workspaceStore.userSettings.exportPresets));

const videoCodecOptions = computed(() =>
  resolveVideoCodecOptions(BASE_VIDEO_CODEC_OPTIONS, videoCodecSupport.value),
);

async function loadCodecSupport() {
  if (isLoadingCodecSupport.value) return;
  isLoadingCodecSupport.value = true;
  try {
    videoCodecSupport.value = await checkVideoCodecSupport(BASE_VIDEO_CODEC_OPTIONS);
  } finally {
    isLoadingCodecSupport.value = false;
  }
}

onMounted(() => {
  loadCodecSupport();
});

watch(
  () => props.isActive,
  (isActive) => {
    if (!isActive) return;
    const selected = selectedPreset.value.videoCodec;
    if (videoCodecSupport.value[selected] === false) {
      toast.add({
        title: t('videoEditor.settings.codecUnsupportedTitle', 'Unsupported codec'),
        description: t(
          'videoEditor.settings.codecUnsupportedDesc',
          'Selected video codec is not supported by your browser. Please choose another codec.',
        ),
        color: 'warning',
        icon: 'i-heroicons-exclamation-triangle',
      });
    }
  },
  { immediate: true },
);



function addPreset() {
  const basePreset = selectedPreset.value;
  const preset = {
    ...basePreset,
    id: createExportPresetId(),
    name: `${basePreset.name} Copy`,
  };

  workspaceStore.userSettings.exportPresets.items.push(preset);
  workspaceStore.userSettings.exportPresets.selectedPresetId = preset.id;
}

function removePreset() {
  const { items, selectedPresetId } = workspaceStore.userSettings.exportPresets;
  if (items.length <= 1) return;

  const index = items.findIndex((preset) => preset.id === selectedPresetId);
  if (index === -1) return;

  items.splice(index, 1);
  const nextPreset = items[Math.max(0, index - 1)] ?? items[0];
  if (!nextPreset) return;

  workspaceStore.userSettings.exportPresets.selectedPresetId = nextPreset.id;
}
</script>

<template>
  <div class="flex flex-col gap-6">


    <div class="flex items-center justify-between gap-3">
      <div class="text-sm font-medium text-ui-text">
        {{ t('videoEditor.settings.userExport', 'Export presets') }}
      </div>
      <div class="flex items-center gap-2">
        <UButton size="xs" color="neutral" variant="ghost" @click="addPreset">
          {{ t('common.create', 'Create') }}
        </UButton>
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          :disabled="workspaceStore.userSettings.exportPresets.items.length <= 1"
          @click="removePreset"
        >
          {{ t('common.delete', 'Delete') }}
        </UButton>
      </div>
    </div>

    <UFormField :label="t('videoEditor.export.presetLabel', 'Preset')">
      <USelectMenu
        v-model="workspaceStore.userSettings.exportPresets.selectedPresetId"
        :items="presetOptions"
        value-key="value"
        label-key="label"
        class="w-full"
      />
    </UFormField>

    <UFormField :label="t('common.name', 'Name')">
      <UInput v-model="selectedPreset.name" class="w-full" />
    </UFormField>

    <MediaEncodingSettings
      v-model:output-format="selectedPreset.format"
      v-model:video-codec="selectedPreset.videoCodec"
      v-model:bitrate-mbps="selectedPreset.bitrateMbps"
      v-model:exclude-audio="selectedPreset.excludeAudio"
      v-model:audio-codec="selectedPreset.audioCodec"
      v-model:audio-bitrate-kbps="selectedPreset.audioBitrateKbps"
      v-model:bitrate-mode="selectedPreset.bitrateMode"
      v-model:keyframe-interval-sec="selectedPreset.keyframeIntervalSec"
      v-model:export-alpha="selectedPreset.exportAlpha"
      :audio-sample-rate="0"
      :show-audio-advanced="true"
      :show-builtin-presets="false"
      :hide-audio-sample-rate="true"
      :disabled="false"
      :show-metadata="false"
      :has-audio="true"
      :is-loading-codec-support="isLoadingCodecSupport"
      :format-options="formatOptions"
      :video-codec-options="videoCodecOptions"
    />
  </div>
</template>
