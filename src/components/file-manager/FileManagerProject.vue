<script setup lang="ts">
import { ref, computed } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import MediaEncodingSettings, {
  type FormatOption,
} from '~/components/media/MediaEncodingSettings.vue';
import MediaResolutionSettings from '~/components/media/MediaResolutionSettings.vue';
import {
  BASE_VIDEO_CODEC_OPTIONS,
  checkVideoCodecSupport,
  resolveVideoCodecOptions,
} from '~/utils/webcodecs';

const { t } = useI18n();
const projectStore = useProjectStore();
const workspaceStore = useWorkspaceStore();

const isClearProjectVardataConfirmOpen = ref(false);

async function confirmClearProjectVardata() {
  isClearProjectVardataConfirmOpen.value = false;
  if (!projectStore.currentProjectId) return;
  await workspaceStore.clearProjectVardata(projectStore.currentProjectId);
}

const formatOptions: readonly FormatOption[] = [
  { value: 'mp4', label: 'MP4' },
  { value: 'webm', label: 'WebM' },
  { value: 'mkv', label: 'MKV' },
];

const videoCodecSupport = ref<Record<string, boolean>>({});
const isLoadingCodecSupport = ref(false);

const videoCodecOptions = computed(() =>
  resolveVideoCodecOptions(BASE_VIDEO_CODEC_OPTIONS, videoCodecSupport.value),
);

async function loadCodecSupport() {
  if (isLoadingCodecSupport.value) return;
  isLoadingCodecSupport.value = true;
  try {
    videoCodecSupport.value = await checkVideoCodecSupport(BASE_VIDEO_CODEC_OPTIONS);
    const selected = projectStore.projectSettings.export.encoding.videoCodec;
    if (videoCodecSupport.value[selected] === false) {
      const firstSupported = BASE_VIDEO_CODEC_OPTIONS.find(
        (opt) => videoCodecSupport.value[opt.value],
      );
      if (firstSupported)
        projectStore.projectSettings.export.encoding.videoCodec = firstSupported.value;
    }
  } finally {
    isLoadingCodecSupport.value = false;
  }
}

// Load on mount
loadCodecSupport();
</script>

<template>
  <div class="flex-1 overflow-y-auto min-h-0 min-w-0">
    <UiConfirmModal
      v-model:open="isClearProjectVardataConfirmOpen"
      :title="t('videoEditor.projectSettings.clearTempTitle', 'Clear temporary files')"
      :description="
        t(
          'videoEditor.projectSettings.clearTempDescription',
          'This will delete generated proxies, thumbnails and cached data for this project.',
        )
      "
      :confirm-text="t('videoEditor.projectSettings.clearTempConfirm', 'Clear')"
      :cancel-text="t('common.cancel', 'Cancel')"
      color="warning"
      icon="i-heroicons-trash"
      @confirm="confirmClearProjectVardata"
    />

    <div class="flex flex-col gap-6 px-3 py-3">
      <div class="text-xs text-ui-text-muted">
        {{
          t('videoEditor.projectSettings.note', 'Settings are saved to .gran/project.settings.json')
        }}
      </div>

      <div class="flex flex-col gap-3">
        <div class="text-sm font-medium text-ui-text">
          {{ t('videoEditor.projectSettings.storage', 'Storage') }}
        </div>

        <div class="flex items-center justify-between gap-3 p-3 rounded border border-ui-border">
          <div class="flex flex-col gap-1 min-w-0">
            <div class="text-sm font-medium text-ui-text">
              {{ t('videoEditor.projectSettings.clearTemp', 'Clear temporary files') }}
            </div>
            <div class="text-xs text-ui-text-muted">
              {{
                t(
                  'videoEditor.projectSettings.clearTempHint',
                  'Removes all files from vardata for this project',
                )
              }}
            </div>
          </div>

          <UButton
            color="warning"
            variant="soft"
            icon="i-heroicons-trash"
            :disabled="!projectStore.currentProjectId"
            :label="t('videoEditor.projectSettings.clearTempAction', 'Clear')"
            @click="isClearProjectVardataConfirmOpen = true"
          />
        </div>
      </div>

      <div class="flex flex-col gap-3">
        <div class="text-sm font-medium text-ui-text">
          {{ t('videoEditor.projectSettings.export', 'Export') }}
        </div>

        <MediaResolutionSettings
          v-model:width="projectStore.projectSettings.export.width"
          v-model:height="projectStore.projectSettings.export.height"
          v-model:fps="projectStore.projectSettings.export.fps"
          v-model:resolution-format="projectStore.projectSettings.export.resolutionFormat"
          v-model:orientation="projectStore.projectSettings.export.orientation"
          v-model:aspect-ratio="projectStore.projectSettings.export.aspectRatio"
          v-model:is-custom-resolution="projectStore.projectSettings.export.isCustomResolution"
        />

        <MediaEncodingSettings
          v-model:output-format="projectStore.projectSettings.export.encoding.format"
          v-model:video-codec="projectStore.projectSettings.export.encoding.videoCodec"
          v-model:bitrate-mbps="projectStore.projectSettings.export.encoding.bitrateMbps"
          v-model:exclude-audio="projectStore.projectSettings.export.encoding.excludeAudio"
          v-model:audio-codec="projectStore.projectSettings.export.encoding.audioCodec"
          v-model:audio-bitrate-kbps="projectStore.projectSettings.export.encoding.audioBitrateKbps"
          :disabled="false"
          :has-audio="true"
          :is-loading-codec-support="isLoadingCodecSupport"
          :format-options="formatOptions"
          :video-codec-options="videoCodecOptions"
        />
      </div>

      
    </div>
  </div>
</template>
