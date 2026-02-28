<script setup lang="ts">
import AppModal from '~/components/ui/AppModal.vue';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import { ref, computed } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useTimelineStore } from '~/stores/timeline.store';
import MediaEncodingSettings, {
  type FormatOption,
} from '~/components/media/MediaEncodingSettings.vue';
import MediaResolutionSettings from '~/components/media/MediaResolutionSettings.vue';
import {
  BASE_VIDEO_CODEC_OPTIONS,
  checkVideoCodecSupport,
  resolveVideoCodecOptions,
} from '~/utils/webcodecs';

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
}>();

const { t } = useI18n();
const projectStore = useProjectStore();
const workspaceStore = useWorkspaceStore();
const timelineStore = useTimelineStore();

const isOpen = computed({
  get: () => props.open,
  set: (value) => emit('update:open', value),
});

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
    const selected = projectStore.projectSettings.exportDefaults.encoding.videoCodec;
    if (videoCodecSupport.value[selected] === false) {
      const firstSupported = BASE_VIDEO_CODEC_OPTIONS.find(
        (opt) => videoCodecSupport.value[opt.value],
      );
      if (firstSupported)
        projectStore.projectSettings.exportDefaults.encoding.videoCodec = firstSupported.value;
    }
  } finally {
    isLoadingCodecSupport.value = false;
  }
}

// Load on mount
loadCodecSupport();

// Project settings form data
const projectName = ref(projectStore.currentProjectName || '');
const timelineName = ref(projectStore.currentFileName || '');
const frameRate = ref(30);
const resolutionWidth = ref(1920);
const resolutionHeight = ref(1080);

const availableFrameRates = [24, 25, 30, 48, 50, 60];
const commonResolutions = [
  { width: 1920, height: 1080, label: '1080p (1920×1080)' },
  { width: 1280, height: 720, label: '720p (1280×720)' },
  { width: 3840, height: 2160, label: '4K (3840×2160)' },
  { width: 2560, height: 1440, label: '2K (2560×1440)' },
];

function applySettings() {
  // Update project settings
  if (projectStore.projectSettings) {
    projectStore.projectSettings.project.fps = frameRate.value;
    projectStore.projectSettings.project.width = resolutionWidth.value;
    projectStore.projectSettings.project.height = resolutionHeight.value;
  }
  
  // Close modal
  isOpen.value = false;
  
  // Show success message
  const toast = useToast();
  toast.add({
    title: t('videoEditor.projectSettings.applied', 'Project settings applied'),
    color: 'success'
  });
}

function resetToDefaults() {
  frameRate.value = 30;
  resolutionWidth.value = 1920;
  resolutionHeight.value = 1080;
}

function onResolutionChange(resolution: { width: number; height: number; label: string }) {
  if (resolution) {
    resolutionWidth.value = resolution.width;
    resolutionHeight.value = resolution.height;
  }
}

function formatDuration(durationUs: number): string {
  const seconds = Math.floor(durationUs / 1_000_000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

function getAllClipsCount(): number {
  if (!timelineStore.timelineDoc?.tracks) return 0;
  return timelineStore.timelineDoc.tracks.reduce((count, track) => {
    return count + (track.items?.length || 0);
  }, 0);
}
</script>

<template>
  <AppModal
    v-model:open="isOpen"
    :title="t('videoEditor.projectSettings.title', 'Project Settings')"
    :ui="{ content: 'max-w-3xl max-h-[90vh]', body: 'overflow-y-auto' }"
  >
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

    <div class="space-y-6">
      <div class="text-xs text-ui-text-muted">
        {{
          t('videoEditor.projectSettings.note', 'Settings are saved to .gran/project.settings.json')
        }}
      </div>

      <!-- Project Info -->
      <div class="space-y-4">
        <h3 class="text-lg font-semibold text-ui-text">{{ t('videoEditor.projectSettings.projectInfo', 'Project Information') }}</h3>
        
        <div class="grid grid-cols-2 gap-4">
          <UFormField :label="t('videoEditor.projectSettings.projectName', 'Project Name')">
            <UInput v-model="projectName" disabled class="bg-ui-bg-muted" />
          </UFormField>
          
          <UFormField :label="t('videoEditor.projectSettings.timelineName', 'Timeline Name')">
            <UInput v-model="timelineName" disabled class="bg-ui-bg-muted" />
          </UFormField>
        </div>
      </div>

      <!-- Current Timeline Info -->
      <div v-if="timelineStore.timelineDoc" class="space-y-4">
        <h3 class="text-lg font-semibold text-ui-text">{{ t('videoEditor.projectSettings.currentTimeline', 'Current Timeline') }}</h3>
        
        <div class="grid grid-cols-2 gap-4 text-sm">
          <div class="space-y-2">
            <div class="flex justify-between">
              <span class="text-ui-text-muted">{{ t('videoEditor.projectSettings.duration', 'Duration') }}:</span>
              <span class="text-ui-text font-mono">{{ formatDuration(timelineStore.duration) }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-ui-text-muted">{{ t('videoEditor.projectSettings.tracks', 'Tracks') }}:</span>
              <span class="text-ui-text">{{ timelineStore.timelineDoc?.tracks?.length || 0 }}</span>
            </div>
          </div>
          <div class="space-y-2">
            <div class="flex justify-between">
              <span class="text-ui-text-muted">{{ t('videoEditor.projectSettings.clips', 'Clips') }}:</span>
              <span class="text-ui-text">{{ getAllClipsCount() }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-ui-text-muted">{{ t('videoEditor.projectSettings.markers', 'Markers') }}:</span>
              <span class="text-ui-text">{{ timelineStore.getMarkers().length }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="h-px bg-ui-border"></div>

      <!-- Resolution & FPS Settings -->
      <div class="space-y-4">
        <h3 class="text-lg font-semibold text-ui-text">{{ t('videoEditor.projectSettings.projectInfo', 'Resolution & FPS') }}</h3>
        
        <MediaResolutionSettings
          v-model:width="projectStore.projectSettings.project.width"
          v-model:height="projectStore.projectSettings.project.height"
          v-model:fps="projectStore.projectSettings.project.fps"
          v-model:resolution-format="projectStore.projectSettings.project.resolutionFormat"
          v-model:orientation="projectStore.projectSettings.project.orientation"
          v-model:aspect-ratio="projectStore.projectSettings.project.aspectRatio"
          v-model:is-custom-resolution="projectStore.projectSettings.project.isCustomResolution"
        />
      </div>

      <div class="h-px bg-ui-border"></div>

      <!-- Export Settings -->
      <div class="space-y-4">
        <h3 class="text-lg font-semibold text-ui-text">{{ t('videoEditor.projectSettings.export', 'Export Defaults') }}</h3>
        
        <MediaEncodingSettings
          v-model:output-format="projectStore.projectSettings.exportDefaults.encoding.format"
          v-model:video-codec="projectStore.projectSettings.exportDefaults.encoding.videoCodec"
          v-model:bitrate-mbps="projectStore.projectSettings.exportDefaults.encoding.bitrateMbps"
          v-model:exclude-audio="projectStore.projectSettings.exportDefaults.encoding.excludeAudio"
          v-model:audio-codec="projectStore.projectSettings.exportDefaults.encoding.audioCodec"
          v-model:audio-bitrate-kbps="projectStore.projectSettings.exportDefaults.encoding.audioBitrateKbps"
          :disabled="false"
          :has-audio="true"
          :is-loading-codec-support="isLoadingCodecSupport"
          :format-options="formatOptions"
          :video-codec-options="videoCodecOptions"
        />
      </div>

      <div class="h-px bg-ui-border"></div>

      <!-- Storage Settings -->
      <div class="space-y-4">
        <h3 class="text-lg font-semibold text-ui-text">{{ t('videoEditor.projectSettings.storage', 'Storage') }}</h3>

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
    </div>

    <template #footer>
      <div class="flex items-center justify-between w-full">
        <UButton
          variant="ghost"
          color="neutral"
          :label="t('videoEditor.projectSettings.reset', 'Reset to Defaults')"
          @click="resetToDefaults"
        />
        <div class="flex items-center gap-2">
          <UButton
            variant="ghost"
            color="neutral"
            :label="t('common.cancel', 'Cancel')"
            @click="isOpen = false"
          />
          <UButton
            variant="solid"
            color="primary"
            :label="t('videoEditor.projectSettings.apply', 'Apply Settings')"
            @click="applySettings"
          />
        </div>
      </div>
    </template>
  </AppModal>
</template>
