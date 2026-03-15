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
import WheelNumberInput from '~/components/ui/WheelNumberInput.vue';
import {
  BASE_AUDIO_CODEC_OPTIONS,
  BASE_VIDEO_CODEC_OPTIONS,
  checkVideoCodecSupport,
  resolveVideoCodecOptions,
} from '~/utils/webcodecs';
import { resolveExportPreset, resolveProjectPreset } from '~/utils/settings';

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
const isResetConfirmOpen = ref(false);

const isResolutionExpanded = ref(false);
const isExportExpanded = ref(false);
const isAdvancedExpanded = ref(false);

const resolutionSummary = computed(() => {
  const p = projectStore.projectSettings?.project;
  if (!p) return '';
  return `${p.width}x${p.height}, ${p.fps}FPS, ${p.sampleRate / 1000}kHz`;
});

const exportSummary = computed(() => {
  const e = projectStore.projectSettings?.exportDefaults?.encoding;
  if (!e) return '';

  const formatLabel = formatOptions.find((f) => f.value === e.format)?.label || e.format || '';
  const format = formatLabel.split(' ')[0]?.toUpperCase() || '';

  const vCodecLabel =
    BASE_VIDEO_CODEC_OPTIONS.find((o) => o.value === e.videoCodec)?.label || e.videoCodec || '';
  const vCodec = vCodecLabel.split(' ')[0]?.toUpperCase() || '';

  const vBitrate = `${e.bitrateMbps || 0}Mb/s`;

  const aCodecLabel =
    BASE_AUDIO_CODEC_OPTIONS.find((o) => o.value === e.audioCodec)?.label || e.audioCodec || '';
  const aCodec = aCodecLabel.split(' ')[0]?.toUpperCase() || '';

  const aBitrate = `${e.audioBitrateKbps || 0} Kb/s`;

  return `${t('videoEditor.projectSettings.export', 'Export')}: ${format} ${vCodec} ${vBitrate} | ${aCodec} ${aBitrate}`;
});
const audioDeclickDurationMs = computed({
  get: () => (projectStore.projectSettings?.project.audioDeclickDurationUs || 0) / 1000,
  set: (val: number) => {
    if (projectStore.projectSettings) {
      projectStore.projectSettings.project.audioDeclickDurationUs = val * 1000;
    }
  },
});

const defaultAudioFadeCurve = computed({
  get: () => projectStore.projectSettings?.project.defaultAudioFadeCurve || 'logarithmic',
  set: (val: 'linear' | 'logarithmic') => {
    if (projectStore.projectSettings) {
      projectStore.projectSettings.project.defaultAudioFadeCurve = val;
    }
  },
});

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

const projectPresetOptions = computed(() =>
  workspaceStore.userSettings.projectPresets.items.map((preset) => ({
    value: preset.id,
    label: preset.name,
  })),
);

const exportPresetOptions = computed(() =>
  workspaceStore.userSettings.exportPresets.items.map((preset) => ({
    value: preset.id,
    label: preset.name,
  })),
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
  await projectStore.saveProjectMeta({}); // Just to trigger a save of the reactive state if needed, though they are usually bound

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
  const pDefaults = resolveProjectPreset(workspaceStore.userSettings.projectPresets);
  projectStore.projectSettings.project.width = pDefaults.width;
  projectStore.projectSettings.project.height = pDefaults.height;
  projectStore.projectSettings.project.fps = pDefaults.fps;
  projectStore.projectSettings.project.resolutionFormat = pDefaults.resolutionFormat;
  projectStore.projectSettings.project.orientation = pDefaults.orientation;
  projectStore.projectSettings.project.aspectRatio = pDefaults.aspectRatio;
  projectStore.projectSettings.project.isCustomResolution = pDefaults.isCustomResolution;
  projectStore.projectSettings.project.sampleRate = pDefaults.sampleRate;
  projectStore.projectSettings.project.defaultAudioFadeCurve =
    workspaceStore.userSettings.projectDefaults.defaultAudioFadeCurve;

  // Reset export encoding settings to workspace defaults
  const eDefaults = resolveExportPreset(workspaceStore.userSettings.exportPresets);
  const exportEncoding = projectStore.projectSettings.exportDefaults.encoding;
  exportEncoding.format = eDefaults.format;
  exportEncoding.videoCodec = eDefaults.videoCodec;
  exportEncoding.bitrateMbps = eDefaults.bitrateMbps;
  exportEncoding.excludeAudio = eDefaults.excludeAudio;
  exportEncoding.audioCodec = eDefaults.audioCodec;
  exportEncoding.audioBitrateKbps = eDefaults.audioBitrateKbps;
  exportEncoding.bitrateMode = eDefaults.bitrateMode;
  exportEncoding.keyframeIntervalSec = eDefaults.keyframeIntervalSec;
  exportEncoding.exportAlpha = eDefaults.exportAlpha;

  await projectStore.saveProjectMeta({
    title: '',
    description: '',
    author: '',
    tags: [],
  });

  await projectStore.saveProjectSettings();
  isResetConfirmOpen.value = false;
}

function applyProjectPreset(presetId: string) {
  if (!projectStore.projectSettings) return;

  const preset =
    workspaceStore.userSettings.projectPresets.items.find((item) => item.id === presetId) ??
    resolveProjectPreset(workspaceStore.userSettings.projectPresets);

  projectStore.projectSettings.project.width = preset.width;
  projectStore.projectSettings.project.height = preset.height;
  projectStore.projectSettings.project.fps = preset.fps;
  projectStore.projectSettings.project.resolutionFormat = preset.resolutionFormat;
  projectStore.projectSettings.project.orientation = preset.orientation;
  projectStore.projectSettings.project.aspectRatio = preset.aspectRatio;
  projectStore.projectSettings.project.isCustomResolution = preset.isCustomResolution;
  projectStore.projectSettings.project.sampleRate = preset.sampleRate;
}

function applyExportPreset(presetId: string) {
  if (!projectStore.projectSettings) return;

  const preset =
    workspaceStore.userSettings.exportPresets.items.find((item) => item.id === presetId) ??
    resolveExportPreset(workspaceStore.userSettings.exportPresets);

  const exportEncoding = projectStore.projectSettings.exportDefaults.encoding;
  exportEncoding.format = preset.format;
  exportEncoding.videoCodec = preset.videoCodec;
  exportEncoding.bitrateMbps = preset.bitrateMbps;
  exportEncoding.excludeAudio = preset.excludeAudio;
  exportEncoding.audioCodec = preset.audioCodec;
  exportEncoding.audioBitrateKbps = preset.audioBitrateKbps;
  exportEncoding.bitrateMode = preset.bitrateMode;
  exportEncoding.keyframeIntervalSec = preset.keyframeIntervalSec;
  exportEncoding.exportAlpha = preset.exportAlpha;
}
const metaTagsString = computed({
  get: () => projectStore.projectMeta?.tags.join(', ') || '',
  set: (val: string) => {
    if (projectStore.projectMeta) {
      projectStore.projectMeta.tags = val
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
    }
  },
});

const metaTitle = computed({
  get: () => projectStore.projectMeta?.title || '',
  set: (val: string) => {
    if (projectStore.projectMeta) {
      projectStore.projectMeta.title = val;
    }
  },
});

const metaAuthor = computed({
  get: () => projectStore.projectMeta?.author || '',
  set: (val: string) => {
    if (projectStore.projectMeta) {
      projectStore.projectMeta.author = val;
    }
  },
});

const metaDescription = computed({
  get: () => projectStore.projectMeta?.description || '',
  set: (val: string) => {
    if (projectStore.projectMeta) {
      projectStore.projectMeta.description = val;
    }
  },
});
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

    <UiConfirmModal
      v-model:open="isResetConfirmOpen"
      :title="t('videoEditor.projectSettings.resetConfirmTitle', 'Reset to defaults?')"
      :description="
        t(
          'videoEditor.projectSettings.resetConfirmDescription',
          'This will restore all project settings to the default values from your workspace settings.',
        )
      "
      :confirm-text="t('videoEditor.projectSettings.reset', 'Reset to Defaults')"
      :cancel-text="t('common.cancel', 'Cancel')"
      color="warning"
      icon="i-heroicons-exclamation-triangle"
      @confirm="resetToDefaults"
    />

    <div v-if="projectStore.projectSettings" class="space-y-6">
      <div class="h-px bg-ui-border"></div>

      <!-- Resolution & FPS Settings -->
      <div class="space-y-4">
        <div
          class="w-full flex justify-between items-center cursor-pointer group"
          @click="isResolutionExpanded = !isResolutionExpanded"
        >
          <div class="flex items-center gap-2">
            <h3 v-show="isResolutionExpanded" class="text-lg font-semibold text-ui-text">
              {{ t('videoEditor.projectSettings.resolutionAndFps', 'Resolution & FPS') }}
            </h3>
            <span v-show="!isResolutionExpanded" class="text-sm text-ui-text-muted font-normal">
              {{ resolutionSummary }}
            </span>
          </div>
          <UIcon
            :name="
              isResolutionExpanded
                ? 'i-heroicons-chevron-down-20-solid'
                : 'i-heroicons-chevron-right-20-solid'
            "
            class="w-5 h-5 text-ui-text-muted group-hover:text-ui-text transition-colors"
          />
        </div>

        <div v-show="isResolutionExpanded" class="space-y-4 pt-2">
          <UFormField :label="t('videoEditor.export.presetLabel', 'Preset')">
            <div class="flex items-center gap-2">
              <USelectMenu
                v-model="workspaceStore.userSettings.projectPresets.selectedPresetId"
                :items="projectPresetOptions"
                value-key="value"
                label-key="label"
                class="w-full"
              />
              <UButton
                color="neutral"
                variant="soft"
                size="sm"
                :label="t('common.apply', 'Apply')"
                @click="
                  applyProjectPreset(workspaceStore.userSettings.projectPresets.selectedPresetId)
                "
              />
            </div>
          </UFormField>

          <MediaResolutionSettings
            v-model:width="projectStore.projectSettings.project.width"
            v-model:height="projectStore.projectSettings.project.height"
            v-model:fps="projectStore.projectSettings.project.fps"
            v-model:resolution-format="projectStore.projectSettings.project.resolutionFormat"
            v-model:orientation="projectStore.projectSettings.project.orientation"
            v-model:aspect-ratio="projectStore.projectSettings.project.aspectRatio"
            v-model:is-custom-resolution="projectStore.projectSettings.project.isCustomResolution"
            v-model:sample-rate="projectStore.projectSettings.project.sampleRate"
          />
        </div>
      </div>

      <div class="h-px bg-ui-border"></div>

      <!-- Export Settings -->
      <div class="space-y-4">
        <div
          class="w-full flex justify-between items-center cursor-pointer group"
          @click="isExportExpanded = !isExportExpanded"
        >
          <div class="flex items-center gap-2">
            <h3 v-show="isExportExpanded" class="text-lg font-semibold text-ui-text">
              {{ t('videoEditor.projectSettings.export', 'Export') }}
            </h3>
            <span v-show="!isExportExpanded" class="text-sm text-ui-text-muted font-normal">
              {{ exportSummary }}
            </span>
          </div>
          <UIcon
            :name="
              isExportExpanded
                ? 'i-heroicons-chevron-down-20-solid'
                : 'i-heroicons-chevron-right-20-solid'
            "
            class="w-5 h-5 text-ui-text-muted group-hover:text-ui-text transition-colors"
          />
        </div>

        <div v-show="isExportExpanded" class="space-y-4 pt-2">
          <UFormField :label="t('videoEditor.export.presetLabel', 'Preset')">
            <div class="flex items-center gap-2">
              <USelectMenu
                v-model="workspaceStore.userSettings.exportPresets.selectedPresetId"
                :items="exportPresetOptions"
                value-key="value"
                label-key="label"
                class="w-full"
              />
              <UButton
                color="neutral"
                variant="soft"
                size="sm"
                :label="t('common.apply', 'Apply')"
                @click="
                  applyExportPreset(workspaceStore.userSettings.exportPresets.selectedPresetId)
                "
              />
            </div>
          </UFormField>

          <MediaEncodingSettings
            v-model:output-format="projectStore.projectSettings.exportDefaults.encoding.format"
            v-model:video-codec="projectStore.projectSettings.exportDefaults.encoding.videoCodec"
            v-model:bitrate-mbps="projectStore.projectSettings.exportDefaults.encoding.bitrateMbps"
            v-model:exclude-audio="
              projectStore.projectSettings.exportDefaults.encoding.excludeAudio
            "
            v-model:audio-codec="projectStore.projectSettings.exportDefaults.encoding.audioCodec"
            v-model:audio-bitrate-kbps="
              projectStore.projectSettings.exportDefaults.encoding.audioBitrateKbps
            "
            v-model:bitrate-mode="projectStore.projectSettings.exportDefaults.encoding.bitrateMode"
            v-model:keyframe-interval-sec="
              projectStore.projectSettings.exportDefaults.encoding.keyframeIntervalSec
            "
            v-model:export-alpha="projectStore.projectSettings.exportDefaults.encoding.exportAlpha"
            v-model:metadata-title="metaTitle"
            v-model:metadata-author="metaAuthor"
            v-model:metadata-tags="metaTagsString"
            v-model:metadata-description="metaDescription"
            :show-audio-advanced="true"
            :show-builtin-presets="false"
            :hide-audio-sample-rate="true"
            :show-metadata="false"
            :disabled="false"
            :has-audio="true"
            :is-loading-codec-support="isLoadingCodecSupport"
            :format-options="formatOptions"
            :video-codec-options="videoCodecOptions"
          />
        </div>
      </div>

      <div class="h-px bg-ui-border"></div>

      <!-- Advanced Settings -->
      <div class="space-y-4">
        <div
          class="w-full flex justify-between items-center cursor-pointer group"
          @click="isAdvancedExpanded = !isAdvancedExpanded"
        >
          <div class="flex items-center gap-2">
            <h3 v-show="isAdvancedExpanded" class="text-lg font-semibold text-ui-text">
              {{ t('videoEditor.projectSettings.advanced', 'Advanced') }}
            </h3>
            <span v-show="!isAdvancedExpanded" class="text-sm text-ui-text-muted font-normal">
              {{ t('videoEditor.projectSettings.advanced', 'Advanced') }}
            </span>
          </div>
          <UIcon
            :name="
              isAdvancedExpanded
                ? 'i-heroicons-chevron-down-20-solid'
                : 'i-heroicons-chevron-right-20-solid'
            "
            class="w-5 h-5 text-ui-text-muted group-hover:text-ui-text transition-colors"
          />
        </div>

        <div v-show="isAdvancedExpanded" class="space-y-4 pt-2">
          <UFormField
            :label="t('videoEditor.settings.audioDeclickDuration', 'Audio De-click Duration')"
          >
            <WheelNumberInput v-model="audioDeclickDurationMs" :min="0" :max="500" :step="1" />
            <template #help>
              {{ t('videoEditor.settings.audioDeclickDurationHelp', 'Micro-fades (linear) applied to edges of all clips to eliminate clicks. 0 disables it.') }}
            </template>
          </UFormField>

          <UFormField
            :label="t('videoEditor.settings.defaultAudioFadeCurveTitle', 'Default Fade Curve')"
            :help="t('videoEditor.settings.defaultAudioFadeCurveHint', 'Default curve used for audio fades when you manually create a fade. (De-click always uses a short linear fade).')"
          >
            <div class="flex items-center gap-1 rounded bg-ui-bg p-1 w-fit">
              <UButton
                size="xs"
                :variant="defaultAudioFadeCurve === 'logarithmic' ? 'solid' : 'ghost'"
                :color="defaultAudioFadeCurve === 'logarithmic' ? 'primary' : 'neutral'"
                @click="defaultAudioFadeCurve = 'logarithmic'"
              >
                Logarithmic
              </UButton>
              <UButton
                size="xs"
                :variant="defaultAudioFadeCurve === 'linear' ? 'solid' : 'ghost'"
                :color="defaultAudioFadeCurve === 'linear' ? 'primary' : 'neutral'"
                @click="defaultAudioFadeCurve = 'linear'"
              >
                Linear
              </UButton>
            </div>
          </UFormField>
        </div>
      </div>

      <div class="h-px bg-ui-border"></div>

      <!-- Project Metadata -->
      <div class="space-y-4">
        <UFormField :label="t('videoEditor.export.metadataTitle', 'Title')">
          <UInput v-model="metaTitle" class="w-full" />
        </UFormField>

        <div class="grid grid-cols-2 gap-4">
          <UFormField :label="t('videoEditor.export.metadataAuthor', 'Author')">
            <UInput v-model="metaAuthor" class="w-full" />
          </UFormField>
          <UFormField :label="t('videoEditor.export.metadataTags', 'Tags')">
            <UInput v-model="metaTagsString" class="w-full" />
          </UFormField>
        </div>

        <UFormField :label="t('videoEditor.export.metadataDescription', 'Description')">
          <UTextarea v-model="metaDescription" :rows="2" class="w-full" />
        </UFormField>
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
          @click="isResetConfirmOpen = true"
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
