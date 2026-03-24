<script setup lang="ts">
import { computed, watch, ref } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useUiStore } from '~/stores/ui.store';
import { useFocusStore } from '~/stores/focus.store';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import VideoEncodingForm from '~/components/media/VideoEncodingForm.vue';
import MediaResolutionSettings from '~/components/media/MediaResolutionSettings.vue';
import UiTextInput from '~/components/ui/UiTextInput.vue';
import UiFormField from '~/components/ui/UiFormField.vue';

import {
  BASE_VIDEO_CODEC_OPTIONS,
  BASE_AUDIO_CODEC_OPTIONS,
  VIDEO_FORMAT_OPTIONS,
} from '~/utils/webcodecs';
import { useExportForm } from '~/composables/timeline/export/useExportForm';

const emit = defineEmits<{
  exported: [];
}>();

const { t } = useI18n();
const projectStore = useProjectStore();
const uiStore = useUiStore();
const focusStore = useFocusStore();
const fileManager = useFileManager();

const isResolutionExpanded = ref(false);
const isEncodingExpanded = ref(false);

const {
  isExporting,
  exportProgress,
  exportError,
  cancelRequested,
  outputFilename,
  filenameError,
  outputFormat,
  videoCodec,
  bitrateMbps,
  excludeAudio,
  audioCodec,
  audioBitrateKbps,
  audioSampleRate,
  exportWidth,
  exportHeight,
  exportFps,
  resolutionFormat,
  orientation,
  aspectRatio,
  isCustomResolution,
  bitrateMode,
  keyframeIntervalSec,
  exportAlpha,
  metadataTitle,
  metadataDescription,
  metadataAuthor,
  metadataTags,

  exportOnlySelectionRange,
  saveAsDefaults,
  hasSelectionRange,
  isSettingsDirty,

  initializeExportForm,
  handleOutputFormatChange,
  handleFilenameExtUpdate,
  handleStartExport,
  getPhaseLabel,
  validateFilename,
  cancelExport,
} = useExportForm();

const resolutionSummary = computed(() => {
  return `${exportWidth.value}x${exportHeight.value}, ${exportFps.value}FPS, ${(audioSampleRate.value || 0) / 1000}kHz`;
});

const encodingSummary = computed(() => {
  const formatLabel =
    VIDEO_FORMAT_OPTIONS.find((f) => f.value === outputFormat.value)?.label ||
    outputFormat.value ||
    '';
  const format = formatLabel.split(' ')[0]?.toUpperCase() || '';

  const vCodecLabel =
    BASE_VIDEO_CODEC_OPTIONS.find((o) => o.value === videoCodec.value)?.label ||
    videoCodec.value ||
    '';
  const vCodec = vCodecLabel.split(' ')[0]?.toUpperCase() || '';

  const vBitrate = `${bitrateMbps.value || 0}Mb/s`;

  const aCodecLabel =
    BASE_AUDIO_CODEC_OPTIONS.find((o) => o.value === audioCodec.value)?.label ||
    audioCodec.value ||
    '';
  const aCodec = aCodecLabel.split(' ')[0]?.toUpperCase() || '';

  const aBitrate = `${audioBitrateKbps.value || 0} Kb/s`;

  return `${t('videoEditor.projectSettings.export', 'Export')}: ${format} ${vCodec} ${vBitrate} | ${aCodec} ${aBitrate}`;
});

function focusExportForm() {
  focusStore.setPanelFocus('exportForm');
}

watch(
  () => projectStore.currentView,
  async (val) => {
    if (val !== 'export') return;
    await initializeExportForm();
  },
  { immediate: true },
);

watch(outputFormat, (fmt) => {
  handleOutputFormatChange(fmt as any);

  if (projectStore.currentView !== 'export') return;
  handleFilenameExtUpdate(fmt as any);
});

watch(outputFilename, async () => {
  if (projectStore.currentView !== 'export') return;
  try {
    await validateFilename();
  } catch {
    // ignore
  }
});

async function onConfirm() {
  await handleStartExport(async () => {
    await fileManager.reloadDirectory('_export');
    uiStore.notifyFileManagerUpdate();
    emit('exported');
  });
}
</script>

<template>
  <div
    class="panel-focus-frame flex flex-col h-full bg-ui-bg-elevated relative overflow-hidden"
    :class="{
      'panel-focus-frame--active': focusStore.isPanelFocused('exportForm'),
    }"
    @pointerdown.capture="focusExportForm"
  >
    <div class="flex-1 overflow-y-auto custom-scrollbar p-6 flex flex-col min-h-0">
      <div class="mb-6 flex items-center justify-between shrink-0">
        <h2 class="text-xl font-semibold text-ui-text">
          {{ t('videoEditor.export.title', 'Export') }}
        </h2>
      </div>

      <div class="flex flex-col gap-6 max-w-2xl flex-1 shrink-0">
        <div
          v-if="hasSelectionRange"
          class="rounded-lg border border-violet-400/40 bg-violet-500/10 px-4 py-3"
        >
          <label class="flex items-center gap-3 cursor-pointer">
            <UCheckbox v-model="exportOnlySelectionRange" :disabled="isExporting" />
            <div class="flex items-center gap-2 min-w-0">
              <UIcon
                name="i-heroicons-exclamation-triangle-solid"
                class="h-5 w-5 shrink-0"
                :class="exportOnlySelectionRange ? 'text-yellow-400' : 'text-ui-text-dimmed'"
              />
              <div class="flex flex-col min-w-0">
                <span class="font-medium text-ui-text">
                  {{ t('videoEditor.export.onlySelectionRange', 'Export only selected zone') }}
                </span>
                <span class="text-sm text-ui-text-muted">
                  {{
                    t(
                      'videoEditor.export.onlySelectionRangeHelp',
                      'When enabled, export uses only the current selection zone. Disable to export the whole timeline.',
                    )
                  }}
                </span>
              </div>
            </div>
          </label>
        </div>

        <div class="flex flex-col gap-1.5">
          <UiFormField
            :label="t('videoEditor.export.filename', 'Filename')"
            :error="filenameError ?? undefined"
          >
            <UiTextInput
              v-model="outputFilename"
              full-width
              :disabled="isExporting"
              :placeholder="t('videoEditor.export.filenamePlaceholder', 'e.g. video.mp4')"
            />
          </UiFormField>
          <div class="text-sm text-ui-text-muted flex items-center gap-1.5 mt-1">
            <UIcon name="i-heroicons-information-circle" class="w-4 h-4 shrink-0" />
            <span class="leading-relaxed">
              {{
                t(
                  'videoEditor.export.saveLocationNote',
                  'File will be saved to the export/ folder in your project directory',
                )
              }}
            </span>
          </div>
        </div>

        <div class="h-px bg-ui-border"></div>

        <!-- Resolution & FPS Settings -->
        <div class="space-y-4">
          <div
            class="w-full flex justify-between items-center cursor-pointer group"
            @click="isResolutionExpanded = !isResolutionExpanded"
          >
            <div class="flex items-center gap-2">
              <h3 v-show="isResolutionExpanded" class="font-semibold text-ui-text">
                {{ t('videoEditor.projectSettings.resolutionAndFps', 'Resolution & FPS') }}
              </h3>
              <span v-show="!isResolutionExpanded" class="text-ui-text-muted font-normal">
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

          <div v-show="isResolutionExpanded" class="pt-2">
            <MediaResolutionSettings
              v-model:width="exportWidth"
              v-model:height="exportHeight"
              v-model:fps="exportFps"
              v-model:resolution-format="resolutionFormat"
              v-model:orientation="orientation"
              v-model:aspect-ratio="aspectRatio"
              v-model:is-custom-resolution="isCustomResolution"
              :disabled="isExporting"
            />
          </div>
        </div>

        <div class="h-px bg-ui-border"></div>

        <!-- Encoding Settings -->
        <div class="space-y-4">
          <div
            class="w-full flex justify-between items-center cursor-pointer group"
            @click="isEncodingExpanded = !isEncodingExpanded"
          >
            <div class="flex items-center gap-2">
              <h3 v-show="isEncodingExpanded" class="font-semibold text-ui-text">
                {{ t('videoEditor.export.encodingSettings', 'Encoding Settings') }}
              </h3>
              <span v-show="!isEncodingExpanded" class="text-ui-text-muted font-normal">
                {{ encodingSummary }}
              </span>
            </div>
            <UIcon
              :name="
                isEncodingExpanded
                  ? 'i-heroicons-chevron-down-20-solid'
                  : 'i-heroicons-chevron-right-20-solid'
              "
              class="w-5 h-5 text-ui-text-muted group-hover:text-ui-text transition-colors"
            />
          </div>

          <div v-show="isEncodingExpanded" class="pt-2">
            <VideoEncodingForm
              v-model:output-format="outputFormat"
              v-model:video-codec="videoCodec"
              v-model:bitrate-mbps="bitrateMbps"
              v-model:exclude-audio="excludeAudio"
              v-model:audio-codec="audioCodec"
              v-model:audio-bitrate-kbps="audioBitrateKbps"
              v-model:audio-sample-rate="audioSampleRate"
              v-model:bitrate-mode="bitrateMode"
              v-model:keyframe-interval-sec="keyframeIntervalSec"
              v-model:export-alpha="exportAlpha"
              v-model:metadata-title="metadataTitle"
              v-model:metadata-description="metadataDescription"
              v-model:metadata-author="metadataAuthor"
              v-model:metadata-tags="metadataTags"
              :show-audio-advanced="true"
              :hide-audio-sample-rate="true"
              :show-metadata="false"
              :show-presets="true"
              :disabled="isExporting"
              :has-audio="true"
            />
          </div>
        </div>

        <div class="h-px bg-ui-border"></div>

        <!-- Metadata Section -->
        <div class="space-y-4">
          <div class="font-semibold text-ui-text text-sm">
            {{ t('videoEditor.export.metadata', 'Metadata') }}
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <UiFormField :label="t('videoEditor.export.metadataTitle', 'Title')">
              <UiTextInput v-model="metadataTitle" :disabled="isExporting" full-width />
            </UiFormField>
            <UiFormField :label="t('videoEditor.export.metadataAuthor', 'Author')">
              <UiTextInput v-model="metadataAuthor" :disabled="isExporting" full-width />
            </UiFormField>
          </div>

          <UiFormField :label="t('videoEditor.export.metadataDescription', 'Description')">
            <UTextarea
              v-model="metadataDescription"
              :disabled="isExporting"
              class="w-full"
              :rows="3"
            />
          </UiFormField>

          <UiFormField :label="t('videoEditor.export.metadataTags', 'Tags')">
            <UiTextInput v-model="metadataTags" :disabled="isExporting" full-width />
          </UiFormField>
        </div>

        <div class="h-px bg-ui-border"></div>

        <label
          class="flex items-center gap-3 mt-2"
          :class="
            isSettingsDirty && !isExporting ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'
          "
        >
          <UCheckbox v-model="saveAsDefaults" :disabled="isExporting || !isSettingsDirty" />
          <span class="text-ui-text text-sm">{{
            t('videoEditor.export.saveAsDefault', 'Save as project settings')
          }}</span>
        </label>

        <div
          v-if="exportError"
          class="p-3 text-sm text-error-400 bg-error-400/10 rounded-md border border-error-400/20"
        >
          {{ exportError }}
        </div>
      </div>
    </div>
    <!-- Close scrollable container -->

    <!-- Fixed Footer -->
    <div class="mt-auto pt-6 border-t border-ui-border p-6 bg-ui-bg-elevated shrink-0">
      <div class="flex flex-col gap-3 w-full">
        <div v-if="isExporting" class="flex flex-col gap-2">
          <div class="flex justify-between text-sm text-ui-text-muted">
            <span class="font-medium">{{ getPhaseLabel() }}</span>
            <span class="font-mono">{{ Math.round(exportProgress * 100) }}%</span>
          </div>
          <UProgress :value="exportProgress * 100" />
          <p class="text-sm text-ui-text-muted text-center mt-1">
            {{
              t(
                'videoEditor.export.doNotClose',
                'Please do not close this window or navigate away during export.',
              )
            }}
          </p>
        </div>
        <div class="flex justify-end gap-2" :class="{ 'mt-2': isExporting }">
          <UButton
            v-if="isSettingsDirty && !isExporting"
            color="neutral"
            variant="ghost"
            :label="t('common.actions.reset', 'Reset')"
            @click="initializeExportForm"
          />
          <UButton
            v-if="isExporting"
            color="neutral"
            variant="ghost"
            :label="t('common.cancel', 'Cancel')"
            :loading="cancelRequested"
            :disabled="cancelRequested"
            @click="cancelExport"
          />
          <UButton
            color="primary"
            variant="solid"
            :label="
              isExporting
                ? t('videoEditor.export.exporting', 'Exporting...')
                : t('videoEditor.export.startExport', 'Export')
            "
            :loading="isExporting"
            :disabled="isExporting || !!filenameError || !outputFilename.trim()"
            @click="onConfirm"
          />
        </div>
      </div>
    </div>
  </div>
</template>
