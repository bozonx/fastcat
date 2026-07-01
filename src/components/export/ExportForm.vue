<script setup lang="ts">
import { computed, watch } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useUiStore } from '~/stores/ui.store';
import { useFocusStore } from '~/stores/focus.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import VideoEncodingForm from '~/components/media/VideoEncodingForm.vue';
import FileConversionAudioSettings from '~/components/file-manager/FileConversionAudioSettings.vue';
import MediaResolutionSettings from '~/components/media/MediaResolutionSettings.vue';
import UiTextInput from '~/components/ui/UiTextInput.vue';
import UiTextarea from '~/components/ui/UiTextarea.vue';
import UiFormField from '~/components/ui/UiFormField.vue';
import UiFormSectionHeader from '~/components/ui/UiFormSectionHeader.vue';
import UiButtonGroup from '~/components/ui/UiButtonGroup.vue';

import { BASE_VIDEO_CODEC_OPTIONS, VIDEO_FORMAT_OPTIONS } from '~/utils/webcodecs';
import { formatFps, middleEllipsis, formatRenderDuration } from '~/utils/format';
import { useExportForm, type ExportRangeOption } from '~/composables/timeline/export/useExportForm';

const props = defineProps<{
  disableFocusFrame?: boolean;
}>();

const emit = defineEmits<{
  exported: [data: { file: File; filename: string }];
}>();

const { t } = useI18n();
const projectStore = useProjectStore();
const timelineStore = useTimelineStore();
const uiStore = useUiStore();
const focusStore = useFocusStore();
const fileManager = useFileManager();

const {
  isExporting,
  exportProgress,
  exportError,
  exportWarnings,
  exportDurationMs,
  lastExportStatus,
  cancelRequested,
  outputFilename,
  filenameError,
  outputFormat,
  videoCodec,
  bitrateMbps,
  excludeAudio,
  audioCodec,
  audioBitrateKbps,
  audioChannels,
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
  fastStart,
  includeMetadata,
  metadataTitle,
  metadataDescription,
  metadataAuthor,
  metadataTags,
  selectedExportRangeId,
  exportRangeOptions,
  hasSelectableExportRanges,
  isSettingsDirty,
  matchTimeline,
  customExportPath,
  isTauri,
  exportType,
  ext,

  initializeExportForm,
  pickTauriExportPath,
  handleOutputFormatChange,
  handleStartExport,
  getPhaseLabel,
  validateFilename,
  cancelExport,
  resetAllSettings,
  resetField,
  isFieldDirty,
} = useExportForm();

const tabOptions = computed(() => [
  { label: t('videoEditor.export.videoTab'), value: 'video' },
  { label: t('videoEditor.export.audioTab'), value: 'audio' },
]);

const resolutionSummary = computed(() => {
  return `${exportWidth.value}x${exportHeight.value}, ${formatFps(exportFps.value)}FPS, ${(audioSampleRate.value || 0) / 1000}kHz`;
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

  return `${t('common.video')}: ${format} ${vCodec} ${vBitrate}`;
});

const exportProgressPercent = computed(() =>
  Math.max(0, Math.min(100, Math.round(exportProgress.value * 100))),
);

function getOptionDuration(option: ExportRangeOption) {
  if (option.id === 'timeline') {
    return (timelineStore.duration || 0) / 1000;
  }
  if (option.range) {
    return (option.range.endUs - option.range.startUs) / 1000;
  }
  return 0;
}

function getOptionIcon(option: ExportRangeOption) {
  if (option.id === 'timeline') {
    return 'i-heroicons-clock';
  }
  if (option.id === 'selection') {
    return 'i-heroicons-arrows-right-left';
  }
  return 'i-heroicons-flag';
}

function getOptionClasses(option: ExportRangeOption) {
  const isSelected = selectedExportRangeId.value === option.id;
  if (!isSelected) {
    return 'border-ui-border bg-transparent hover:bg-white/5';
  }
  if (option.id === 'timeline') {
    return 'border-violet-500/40 bg-violet-500/10';
  }
  if (option.id === 'selection') {
    return 'border-blue-500/40 bg-blue-500/10';
  }
  if (!option.color) {
    return 'border-yellow-500/40 bg-yellow-500/10';
  }
  return 'border-solid';
}

function getOptionStyles(option: ExportRangeOption) {
  const isSelected = selectedExportRangeId.value === option.id;
  if (isSelected && option.id.startsWith('marker:') && option.color) {
    return {
      borderColor: `${option.color}60`,
      backgroundColor: `${option.color}15`,
    };
  }
  return {};
}

function getRadioCircleClasses(option: ExportRangeOption) {
  const isSelected = selectedExportRangeId.value === option.id;
  if (!isSelected) {
    return 'border-ui-border-muted';
  }
  if (option.id === 'timeline') {
    return 'border-violet-400';
  }
  if (option.id === 'selection') {
    return 'border-blue-400';
  }
  if (!option.color) {
    return 'border-yellow-400';
  }
  return '';
}

function getRadioCircleStyles(option: ExportRangeOption) {
  const isSelected = selectedExportRangeId.value === option.id;
  if (isSelected && option.id.startsWith('marker:') && option.color) {
    return {
      borderColor: option.color,
    };
  }
  return {};
}

function getRadioDotClasses(option: ExportRangeOption) {
  if (option.id === 'timeline') {
    return 'bg-violet-400';
  }
  if (option.id === 'selection') {
    return 'bg-blue-400';
  }
  if (!option.color) {
    return 'bg-yellow-400';
  }
  return '';
}

function getRadioDotStyles(option: ExportRangeOption) {
  if (option.id.startsWith('marker:') && option.color) {
    return {
      backgroundColor: option.color,
    };
  }
  return {};
}

function getIconClasses(option: ExportRangeOption) {
  const isSelected = selectedExportRangeId.value === option.id;
  if (!isSelected) {
    return 'text-ui-text-muted';
  }
  if (option.id === 'timeline') {
    return 'text-violet-400';
  }
  if (option.id === 'selection') {
    return 'text-blue-400';
  }
  if (!option.color) {
    return 'text-yellow-400';
  }
  return '';
}

function getIconStyles(option: ExportRangeOption) {
  if (option.id.startsWith('marker:')) {
    return {
      color: option.color || '#eab308',
    };
  }
  return {};
}

function focusExportForm() {
  if (props.disableFocusFrame) return;
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
  if (exportType.value !== 'video') return;
  handleOutputFormatChange(fmt);
});

watch(outputFilename, async () => {
  if (projectStore.currentView !== 'export') return;
  try {
    await validateFilename();
  } catch {
    // ignore
  }
});

const videoAudioCodec = computed<'aac' | 'opus' | 'flac' | 'pcm' | 'mp3'>({
  get: () => audioCodec.value,
  set: (val) => {
    audioCodec.value = val;
  },
});

async function onConfirm() {
  await handleStartExport(async (file: File) => {
    await fileManager.reloadDirectory('_export');
    uiStore.notifyFileManagerUpdate();
    emit('exported', { file, filename: outputFilename.value });
  });
}

const filenamePlaceholder = computed(() =>
  t('videoEditor.export.filenamePlaceholder', { ext: ext.value }),
);
</script>

<template>
  <div
    class="flex flex-col h-full bg-ui-bg-elevated relative overflow-hidden"
    :class="{
      'panel-focus-frame': !props.disableFocusFrame,
      'panel-focus-frame--active':
        !props.disableFocusFrame && focusStore.isPanelFocused('exportForm'),
    }"
    @pointerdown.capture="focusExportForm"
  >
    <div class="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-6 flex flex-col min-h-0">
      <div class="mb-6 flex items-center justify-between shrink-0">
        <h2 class="text-xl font-semibold text-ui-text">
          {{ t('videoEditor.export.title') }}
        </h2>
      </div>

      <UiButtonGroup v-model="exportType" :options="tabOptions" class="mb-6 shrink-0" fluid />

      <div class="flex flex-col gap-6 max-w-2xl flex-1 shrink-0">
        <div v-if="hasSelectableExportRanges" class="flex flex-col gap-2">
          <div class="text-sm font-medium text-ui-text">
            {{ t('videoEditor.export.rangeSourceTitle') }}
          </div>

          <div class="max-h-48 overflow-y-auto custom-scrollbar pr-1 flex flex-col gap-2 min-w-0">
            <button
              v-for="option in exportRangeOptions"
              :key="option.id"
              type="button"
              :disabled="isExporting"
              class="flex items-center justify-between gap-3 rounded-md border text-left px-3 py-2 transition-all cursor-pointer min-w-0 w-full"
              :class="getOptionClasses(option)"
              :style="getOptionStyles(option)"
              @click="selectedExportRangeId = option.id"
            >
              <div class="flex items-start gap-2.5 min-w-0 flex-1">
                <!-- Custom Radio Indicator -->
                <div class="flex items-center justify-center shrink-0 mt-1 relative">
                  <div
                    class="h-4 w-4 rounded-full border flex items-center justify-center transition-colors"
                    :class="getRadioCircleClasses(option)"
                    :style="getRadioCircleStyles(option)"
                  >
                    <div
                      v-if="selectedExportRangeId === option.id"
                      class="h-2 w-2 rounded-full"
                      :class="getRadioDotClasses(option)"
                      :style="getRadioDotStyles(option)"
                    />
                  </div>
                </div>

                <!-- Range Type Icon -->
                <UIcon
                  :name="getOptionIcon(option)"
                  class="h-5 w-5 shrink-0 mt-0.5"
                  :class="getIconClasses(option)"
                  :style="getIconStyles(option)"
                />

                <!-- Labels -->
                <div class="min-w-0 flex-1 flex flex-col">
                  <span class="font-medium text-sm text-ui-text truncate">
                    {{ option.label }}
                  </span>
                  <span
                    v-if="option.description"
                    class="text-xs text-ui-text-muted truncate mt-0.5"
                    :title="option.description"
                  >
                    {{ option.description }}
                  </span>
                </div>
              </div>

              <!-- Duration Badge -->
              <span class="shrink-0 text-xs font-mono text-ui-text-muted">
                {{ formatRenderDuration(getOptionDuration(option)) }}
              </span>
            </button>
          </div>
        </div>

        <div class="flex flex-col gap-1.5">
          <UiFormField
            :label="t('videoEditor.export.filename')"
            :error="filenameError ?? undefined"
            :help="!isTauri ? t('videoEditor.export.saveLocationNote') : undefined"
          >
            <UiTextInput
              v-model="outputFilename"
              full-width
              :disabled="isExporting"
              :placeholder="filenamePlaceholder"
            />
          </UiFormField>
          <template v-if="isTauri">
            <div
              v-if="!customExportPath"
              class="flex items-center gap-1.5 mt-1 text-xs text-ui-text-muted"
            >
              <UIcon name="i-heroicons-information-circle" class="h-4 w-4 shrink-0" />
              <span class="leading-relaxed">
                {{ t('videoEditor.export.defaultExportFolderNote') }}
              </span>
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                :label="t('videoEditor.export.changeFolder')"
                :disabled="isExporting"
                @click="pickTauriExportPath"
              />
            </div>
            <div v-else class="flex items-center gap-1.5 mt-1 text-xs text-ui-text-muted">
              <UIcon name="i-heroicons-check-circle" class="h-4 w-4 shrink-0 text-success" />
              <span
                class="overflow-hidden whitespace-nowrap leading-relaxed"
                :title="customExportPath"
              >
                {{ middleEllipsis(customExportPath) }}
              </span>
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-heroicons-x-mark"
                :disabled="isExporting"
                @click="void (customExportPath = null)"
              />
            </div>
          </template>
        </div>

        <!-- Resolution & FPS Settings (Video only) -->
        <div v-show="exportType === 'video'" class="space-y-4">
          <div class="text-ui-text-muted font-normal">
            {{ resolutionSummary }}
          </div>

          <UCheckbox
            v-model="matchTimeline"
            :disabled="isExporting"
            :label="t('videoEditor.export.matchTimeline')"
            :ui="{ label: 'text-sm text-ui-text' }"
            class="cursor-pointer"
          />

          <MediaResolutionSettings
            v-show="!matchTimeline"
            v-model:width="exportWidth"
            v-model:height="exportHeight"
            v-model:fps="exportFps"
            v-model:resolution-format="resolutionFormat"
            v-model:orientation="orientation"
            v-model:aspect-ratio="aspectRatio"
            v-model:is-custom-resolution="isCustomResolution"
            v-model:sample-rate="audioSampleRate"
            :disabled="isExporting || matchTimeline"
          />
        </div>

        <div v-show="exportType === 'video'" class="h-px bg-ui-border"></div>

        <!-- Encoding Settings (Video only) -->
        <div v-show="exportType === 'video'" class="space-y-4">
          <div class="text-ui-text-muted font-normal">
            {{ encodingSummary }}
          </div>

          <VideoEncodingForm
            v-model:output-format="outputFormat"
            v-model:video-codec="videoCodec"
            v-model:bitrate-mbps="bitrateMbps"
            v-model:exclude-audio="excludeAudio"
            v-model:audio-codec="videoAudioCodec"
            v-model:audio-bitrate-kbps="audioBitrateKbps"
            v-model:audio-channels="audioChannels"
            v-model:audio-sample-rate="audioSampleRate"
            v-model:bitrate-mode="bitrateMode"
            v-model:keyframe-interval-sec="keyframeIntervalSec"
            v-model:export-alpha="exportAlpha"
            v-model:fast-start="fastStart"
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

        <div v-show="exportType === 'video'" class="h-px bg-ui-border"></div>

        <!-- Audio Settings (Audio only) -->
        <div v-show="exportType === 'audio'" class="space-y-4">
          <FileConversionAudioSettings
            v-model:audio-codec="audioCodec"
            v-model:audio-bitrate-kbps="audioBitrateKbps"
            v-model:audio-channels="audioChannels"
            v-model:audio-sample-rate="audioSampleRate"
            :disabled="isExporting"
            :allow-original-sample-rate="false"
            :timeline-sample-rate="timelineStore.timelineFormat?.sampleRate"
          />
        </div>

        <div v-show="exportType === 'audio'" class="h-px bg-ui-border"></div>

        <div class="space-y-4">
          <UiFormSectionHeader :title="t('videoEditor.export.metadata')" />

          <UCheckbox
            v-model="includeMetadata"
            :disabled="isExporting"
            :label="t('videoEditor.export.includeMetadata')"
            :ui="{ label: 'text-sm text-ui-text' }"
            class="cursor-pointer"
          />

          <div v-if="includeMetadata" class="space-y-4 pt-2">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <UiFormField :label="t('videoEditor.export.metadataTitle')">
                <div class="flex items-center gap-1.5 w-full">
                  <UiTextInput
                    v-model="metadataTitle"
                    :disabled="isExporting"
                    full-width
                    class="flex-grow"
                  />
                  <UButton
                    v-if="isFieldDirty('metadataTitle')"
                    icon="i-heroicons-arrow-path-20-solid"
                    color="warning"
                    variant="ghost"
                    size="xs"
                    class="shrink-0"
                    @click="resetField('metadataTitle')"
                  />
                </div>
              </UiFormField>
              <UiFormField :label="t('videoEditor.export.metadataAuthor')">
                <div class="flex items-center gap-1.5 w-full">
                  <UiTextInput
                    v-model="metadataAuthor"
                    :disabled="isExporting"
                    full-width
                    class="flex-grow"
                  />
                  <UButton
                    v-if="isFieldDirty('metadataAuthor')"
                    icon="i-heroicons-arrow-path-20-solid"
                    color="warning"
                    variant="ghost"
                    size="xs"
                    class="shrink-0"
                    @click="resetField('metadataAuthor')"
                  />
                </div>
              </UiFormField>
            </div>

            <UiFormField :label="t('videoEditor.export.metadataDescription')">
              <div class="flex items-start gap-1.5 w-full">
                <UiTextarea
                  v-model="metadataDescription"
                  :disabled="isExporting || (exportType === 'audio' && audioCodec === 'pcm')"
                  :rows="3"
                  autoresize
                  :maxrows="10"
                  full-width
                  class="flex-grow"
                />
                <UButton
                  v-if="isFieldDirty('metadataDescription')"
                  icon="i-heroicons-arrow-path-20-solid"
                  color="warning"
                  variant="ghost"
                  size="xs"
                  class="shrink-0 mt-2"
                  @click="resetField('metadataDescription')"
                />
              </div>
            </UiFormField>

            <UiFormField :label="t('videoEditor.export.metadataTags')">
              <div class="flex items-center gap-1.5 w-full">
                <UiTextInput
                  v-model="metadataTags"
                  :disabled="isExporting || (exportType === 'audio' && audioCodec === 'pcm')"
                  full-width
                  class="flex-grow"
                />
                <UButton
                  v-if="isFieldDirty('metadataTags')"
                  icon="i-heroicons-arrow-path-20-solid"
                  color="warning"
                  variant="ghost"
                  size="xs"
                  class="shrink-0"
                  @click="resetField('metadataTags')"
                />
              </div>
            </UiFormField>
          </div>
        </div>

        <div
          v-if="lastExportStatus === 'success' && exportDurationMs !== null"
          data-testid="export-success"
          class="p-3 text-sm text-success-400 bg-success-400/10 rounded-md border border-success-400/20"
        >
          {{
            t('videoEditor.export.successMessage', {
              duration: formatRenderDuration(exportDurationMs),
            })
          }}
        </div>

        <div
          v-if="exportError"
          class="p-3 text-sm text-error-400 bg-error-400/10 rounded-md border border-error-400/20"
        >
          <div>{{ exportError }}</div>
          <div v-if="exportDurationMs !== null" class="mt-1 text-xs text-error-300">
            {{
              t('videoEditor.export.durationLabel', {
                duration: formatRenderDuration(exportDurationMs),
              })
            }}
          </div>
        </div>

        <div
          v-if="exportWarnings && exportWarnings.length > 0"
          class="p-3 text-sm text-amber-300 bg-amber-400/10 rounded-md border border-amber-400/20 flex flex-col gap-1"
        >
          <div class="font-medium flex items-center gap-1.5">
            <UIcon name="i-heroicons-exclamation-triangle" class="w-4 h-4" />
            {{ t('videoEditor.export.warningsTitle', { count: exportWarnings.length }) }}
          </div>
          <ul class="list-disc list-inside space-y-0.5">
            <li v-for="(w, i) in exportWarnings" :key="i" class="text-xs leading-snug">
              {{ w }}
            </li>
          </ul>
        </div>
      </div>
    </div>
    <!-- Close scrollable container -->

    <!-- Fixed Footer -->
    <div
      class="mt-auto pt-4 md:pt-6 border-t border-ui-border p-4 md:p-6 bg-ui-bg-elevated shrink-0"
    >
      <div class="flex flex-col gap-3 w-full">
        <div v-if="isExporting" data-testid="export-progress" class="flex flex-col gap-2">
          <div class="flex justify-between text-sm text-ui-text-muted">
            <span class="font-medium">{{ getPhaseLabel() }}</span>
            <span class="font-mono">{{ exportProgressPercent }}%</span>
          </div>
          <div
            class="h-2 w-full overflow-hidden rounded-full bg-ui-bg-muted"
            role="progressbar"
            :aria-valuenow="exportProgressPercent"
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <div
              class="h-full rounded-full bg-amber-400 transition-[width] duration-200 ease-out"
              :style="{ width: `${exportProgressPercent}%` }"
            />
          </div>
          <p class="text-sm text-ui-text-muted text-center mt-1">
            {{ t('videoEditor.export.doNotClose') }}
          </p>
        </div>
        <div class="flex flex-wrap justify-end gap-2" :class="{ 'mt-2': isExporting }">
          <UButton
            v-if="isSettingsDirty && !isExporting"
            color="neutral"
            variant="ghost"
            :label="t('common.actions.reset')"
            @click="resetAllSettings"
          />
          <UButton
            v-if="isExporting"
            color="neutral"
            variant="ghost"
            :label="t('common.cancel')"
            :loading="cancelRequested"
            :disabled="cancelRequested"
            @click="cancelExport"
          />
          <UButton
            data-testid="export-start"
            color="primary"
            variant="solid"
            :label="
              isExporting ? t('videoEditor.export.exporting') : t('videoEditor.export.startExport')
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
