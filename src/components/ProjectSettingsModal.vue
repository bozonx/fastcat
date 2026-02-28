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
const isDeleteProjectConfirmOpen = ref(false);

async function confirmClearProjectVardata() {
  isClearProjectVardataConfirmOpen.value = false;
  if (!projectStore.currentProjectId) return;
  await workspaceStore.clearProjectVardata(projectStore.currentProjectId);
}

async function confirmDeleteProject() {
  isDeleteProjectConfirmOpen.value = false;
  await projectStore.deleteCurrentProject();
  // Closing the current project will automatically return the user to the projects list
  // because projectStore.currentProjectName becomes null and the view switches in index.vue
}

const formatOptions: readonly FormatOption[] = [
  { value: 'mp4', label: 'MP4' },
  { value: 'webm', label: 'WebM (VP9/OPUS)' },
  { value: 'mkv', label: 'MKV (AV1|OPUS)' },
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
  } finally {
    isLoadingCodecSupport.value = false;
  }
}

// Load on mount
loadCodecSupport();

// Project settings form data
async function applySettings() {
  // Settings are already bound via v-model and saved automatically in projectStore

  // Close modal
  isOpen.value = false;

  await projectStore.saveProjectSettings();

  // Show success message
  const toast = useToast();
  toast.add({
    title: t('videoEditor.projectSettings.applied', 'Project settings applied'),
    color: 'success',
  });
}

async function resetToDefaults() {
  if (!projectStore.projectSettings) return;

  // Reset project resolution and FPS to workspace defaults
  const pDefaults = workspaceStore.userSettings.projectDefaults;
  projectStore.projectSettings.project.width = pDefaults.width;
  projectStore.projectSettings.project.height = pDefaults.height;
  projectStore.projectSettings.project.fps = pDefaults.fps;
  projectStore.projectSettings.project.resolutionFormat = pDefaults.resolutionFormat;
  projectStore.projectSettings.project.orientation = pDefaults.orientation;
  projectStore.projectSettings.project.aspectRatio = pDefaults.aspectRatio;
  projectStore.projectSettings.project.isCustomResolution = pDefaults.isCustomResolution;

  // Reset export encoding settings to workspace defaults
  const eDefaults = workspaceStore.userSettings.exportDefaults.encoding;
  projectStore.projectSettings.exportDefaults.encoding = {
    ...eDefaults,
    metadata: { title: '', author: '', tags: '' },
  };

  await projectStore.saveProjectSettings();
}
</script>

<template>
  <AppModal
    v-model:open="isOpen"
    :title="
      t('videoEditor.projectSettings.title', 'Project Settings') +
      (projectStore.currentProjectName ? ': ' + projectStore.currentProjectName : '')
    "
    :ui="{ content: 'sm:max-w-lg max-h-[90vh]', body: 'overflow-y-auto' }"
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

    <UiConfirmModal
      v-model:open="isDeleteProjectConfirmOpen"
      :title="t('videoEditor.projectSettings.deleteProjectConfirmTitle', 'Delete Project?')"
      :description="
        t(
          'videoEditor.projectSettings.deleteProjectConfirmDescription',
          'This will permanently delete the project folder and all its contents. This action cannot be undone.',
        )
      "
      :confirm-text="t('videoEditor.projectSettings.deleteProjectAction', 'Delete')"
      :cancel-text="t('common.cancel', 'Cancel')"
      color="error"
      icon="i-heroicons-trash"
      @confirm="confirmDeleteProject"
    />

    <div class="space-y-6">
      <div class="text-xs text-ui-text-muted">
        {{
          t('videoEditor.projectSettings.note', 'Settings are saved to .gran/project.settings.json')
        }}
      </div>

      <!-- Resolution & FPS Settings -->
      <div class="space-y-4">
        <h3 class="text-lg font-semibold text-ui-text">
          {{ t('videoEditor.projectSettings.resolutionAndFps', 'Resolution & FPS') }}
        </h3>

        <MediaResolutionSettings
          v-model:width="projectStore.projectSettings.project.width"
          v-model:height="projectStore.projectSettings.project.height"
          v-model:fps="projectStore.projectSettings.project.fps"
          v-model:resolution-format="projectStore.projectSettings.project.resolutionFormat"
          v-model:orientation="projectStore.projectSettings.project.orientation"
          v-model:aspect-ratio="projectStore.projectSettings.project.aspectRatio"
          v-model:is-custom-resolution="projectStore.projectSettings.project.isCustomResolution"
          v-model:audio-channels="projectStore.projectSettings.project.audioChannels"
          v-model:sample-rate="projectStore.projectSettings.project.sampleRate"
        />
      </div>

      <div class="h-px bg-ui-border"></div>

      <!-- Export Settings -->
      <div class="space-y-4">
        <h3 class="text-lg font-semibold text-ui-text">
          {{ t('videoEditor.projectSettings.export', 'Export Defaults') }}
        </h3>

        <MediaEncodingSettings
          v-model:output-format="projectStore.projectSettings.exportDefaults.encoding.format"
          v-model:video-codec="projectStore.projectSettings.exportDefaults.encoding.videoCodec"
          v-model:bitrate-mbps="projectStore.projectSettings.exportDefaults.encoding.bitrateMbps"
          v-model:exclude-audio="projectStore.projectSettings.exportDefaults.encoding.excludeAudio"
          v-model:audio-codec="projectStore.projectSettings.exportDefaults.encoding.audioCodec"
          v-model:audio-bitrate-kbps="
            projectStore.projectSettings.exportDefaults.encoding.audioBitrateKbps
          "
          v-model:bitrate-mode="projectStore.projectSettings.exportDefaults.encoding.bitrateMode"
          v-model:keyframe-interval-sec="
            projectStore.projectSettings.exportDefaults.encoding.keyframeIntervalSec
          "
          v-model:export-alpha="projectStore.projectSettings.exportDefaults.encoding.exportAlpha"
          v-model:metadata-title="
            projectStore.projectSettings.exportDefaults.encoding.metadata.title
          "
          v-model:metadata-author="
            projectStore.projectSettings.exportDefaults.encoding.metadata.author
          "
          v-model:metadata-tags="projectStore.projectSettings.exportDefaults.encoding.metadata.tags"
          :show-metadata="true"
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
        <h3 class="text-lg font-semibold text-ui-text">
          {{ t('videoEditor.projectSettings.storage', 'Storage') }}
        </h3>

        <div class="space-y-3">
          <!-- Clear Vardata -->
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

          <!-- Delete Project -->
          <div
            class="flex items-center justify-between gap-3 p-3 rounded border border-error-500/20 bg-error-500/5"
          >
            <div class="flex flex-col gap-1 min-w-0">
              <div class="text-sm font-medium text-error-400">
                {{ t('videoEditor.projectSettings.deleteProject', 'Delete Project') }}
              </div>
              <div class="text-xs text-error-400/70">
                {{
                  t(
                    'videoEditor.projectSettings.deleteProjectConfirmDescription',
                    'Permanently delete project folder and all its content',
                  )
                }}
              </div>
            </div>

            <UButton
              color="error"
              variant="solid"
              icon="i-heroicons-trash"
              :label="t('videoEditor.projectSettings.deleteProjectAction', 'Delete')"
              @click="isDeleteProjectConfirmOpen = true"
            />
          </div>
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
            @click="(isOpen = false) && projectStore.saveProjectSettings()"
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
