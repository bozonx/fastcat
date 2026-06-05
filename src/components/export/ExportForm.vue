<script setup lang="ts">
import { computed, watch, ref } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useUiStore } from '~/stores/ui.store';
import { useFocusStore } from '~/stores/focus.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import VideoEncodingForm from '~/components/media/VideoEncodingForm.vue';
import FileConversionAudioSettings from '~/components/file-manager/FileConversionAudioSettings.vue';
import MediaResolutionSettings from '~/components/media/MediaResolutionSettings.vue';
import UiTextInput from '~/components/ui/UiTextInput.vue';
import UiTextarea from '~/components/ui/UiTextarea.vue';
import UiFormField from '~/components/ui/UiFormField.vue';
import UiFormSectionHeader from '~/components/ui/UiFormSectionHeader.vue';
import UiTabs from '~/components/ui/UiTabs.vue';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
import UiButtonGroup from '~/components/ui/UiButtonGroup.vue';

import {
  BASE_VIDEO_CODEC_OPTIONS,
  BASE_AUDIO_CODEC_OPTIONS,
  VIDEO_FORMAT_OPTIONS,
} from '~/utils/webcodecs';
import { formatFps } from '~/utils/format';
import { useExportForm } from '~/composables/timeline/export/useExportForm';

const props = defineProps<{
  disableFocusFrame?: boolean;
}>();

const emit = defineEmits<{
  exported: [data: { file: File; filename: string }];
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
  exportWarnings,
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
  metadataTitle,
  metadataDescription,
  metadataAuthor,
  metadataTags,
  audioCodecSupport,

  selectedExportRangeId,
  saveAsDefaults,
  exportRangeOptions,
  hasSelectableExportRanges,
  isSettingsDirty,
  matchTimeline,
  customWidth,
  customHeight,
  customFps,
  customAudioSampleRate,
  customExportPath,
  isTauri,
  exportType,

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
  { label: t('videoEditor.export.videoTab', 'Экспорт видео'), value: 'video' },
  { label: t('videoEditor.export.audioTab', 'Экспорт аудио'), value: 'audio' },
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

  const aCodecLabel =
    BASE_AUDIO_CODEC_OPTIONS.find((o) => o.value === audioCodec.value)?.label ||
    audioCodec.value ||
    '';
  const aCodec = aCodecLabel.split(' ')[0]?.toUpperCase() || '';

  const aBitrate = `${audioBitrateKbps.value || 0} Kb/s`;

  return `${t('videoEditor.projectSettings.export')}: ${format} ${vCodec} ${vBitrate} | ${aCodec} ${aBitrate}`;
});

const exportRangeRadioItems = computed(() =>
  exportRangeOptions.value.map((option) => ({
    value: option.id,
    label: option.label,
    description: option.description,
    class:
      selectedExportRangeId.value === option.id
        ? 'bg-violet-500/10 border-violet-400/30'
        : 'hover:bg-white/5',
  })),
);

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

      <UiTabs v-model="exportType" :options="tabOptions" class="mb-6 shrink-0" />

      <div class="flex flex-col gap-6 max-w-2xl flex-1 shrink-0">
        <div
          v-if="hasSelectableExportRanges"
          class="rounded-lg border border-violet-400/40 bg-violet-500/10 px-4 py-4"
        >
          <div class="flex items-start gap-2 mb-3">
            <UIcon
              name="i-heroicons-exclamation-triangle-solid"
              class="h-5 w-5 shrink-0 text-yellow-400 mt-0.5"
            />
            <div class="min-w-0">
              <div class="font-medium text-ui-text">
                {{ t('videoEditor.export.rangeSourceTitle') }}
              </div>
              <div class="text-sm text-ui-text-muted">
                {{ t('videoEditor.export.rangeSourceHelp') }}
              </div>
            </div>
          </div>

          <URadioGroup
            v-model="selectedExportRangeId"
            :items="exportRangeRadioItems"
            :disabled="isExporting"
            indicator="hidden"
            :ui="{
              fieldset: 'flex flex-col gap-2',
              item: 'flex items-start gap-3 rounded-md border border-transparent px-3 py-2 transition-colors cursor-pointer',
              wrapper: 'min-w-0',
              label: 'font-medium text-ui-text',
              description: 'text-sm text-ui-text-muted truncate',
            }"
          />
        </div>

        <div class="flex flex-col gap-1.5">
          <UiFormField
            :label="t('videoEditor.export.filename')"
            :error="filenameError ?? undefined"
          >
            <UiTextInput
              v-model="outputFilename"
              full-width
              :disabled="isExporting"
              :placeholder="t('videoEditor.export.filenamePlaceholder')"
            />
          </UiFormField>
          <div v-if="isTauri" class="mt-1">
            <div v-if="!customExportPath" class="flex items-center gap-1.5">
              <UIcon name="i-heroicons-information-circle" class="h-4 w-4 shrink-0 text-ui-text-muted" />
              <span class="text-sm text-ui-text-muted leading-relaxed">
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
            <div v-else class="flex items-center gap-1.5 text-sm text-ui-text-muted">
              <UIcon name="i-heroicons-check-circle" class="h-4 w-4 shrink-0 text-success" />
              <span class="truncate leading-relaxed">{{ customExportPath }}</span>
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-heroicons-x-mark"
                :disabled="isExporting"
                @click="customExportPath = null"
              />
            </div>
          </div>
          <div v-else class="text-sm text-ui-text-muted flex items-center gap-1.5 mt-1">
            <UIcon name="i-heroicons-information-circle" class="h-4 w-4 shrink-0" />
            <span class="leading-relaxed">
              {{ t('videoEditor.export.saveLocationNote') }}
            </span>
          </div>
        </div>

        <!-- Resolution & FPS Settings (Video only) -->
        <div v-show="exportType === 'video'" class="space-y-4">
          <div
            class="w-full flex justify-between items-center cursor-pointer group"
            @click="isResolutionExpanded = !isResolutionExpanded"
          >
            <div class="flex items-center gap-2">
              <h3 v-show="isResolutionExpanded" class="font-semibold text-ui-text">
                {{ t('videoEditor.projectSettings.resolutionAndFps') }}
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

          <div v-show="isResolutionExpanded" class="pt-2 space-y-4">
            <div class="flex items-center gap-3">
              <UCheckbox v-model="matchTimeline" :disabled="isExporting" />
              <span class="text-ui-text text-sm">{{ t('videoEditor.export.matchTimeline') }}</span>
              <UButton
                v-if="isFieldDirty('matchTimeline')"
                icon="i-heroicons-arrow-path-20-solid"
                color="warning"
                variant="ghost"
                size="xs"
                @click="resetField('matchTimeline')"
                class="shrink-0"
              />
            </div>
            <MediaResolutionSettings
              v-model:width="exportWidth"
              v-model:height="exportHeight"
              v-model:fps="exportFps"
              v-model:resolution-format="resolutionFormat"
              v-model:orientation="orientation"
              v-model:aspect-ratio="aspectRatio"
              v-model:is-custom-resolution="isCustomResolution"
              :disabled="isExporting || matchTimeline"
            />
          </div>
        </div>

        <div v-show="exportType === 'video'" class="h-px bg-ui-border"></div>

        <!-- Encoding Settings (Video only) -->
        <div v-show="exportType === 'video'" class="space-y-4">
          <div
            class="w-full flex justify-between items-center cursor-pointer group"
            @click="isEncodingExpanded = !isEncodingExpanded"
          >
            <div class="flex items-center gap-2">
              <h3 v-show="isEncodingExpanded" class="font-semibold text-ui-text">
                {{ t('videoEditor.export.encodingSettings') }}
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
              v-model:audio-codec="videoAudioCodec"
              v-model:audio-bitrate-kbps="audioBitrateKbps"
              v-model:audio-channels="audioChannels"
              v-model:audio-sample-rate="audioSampleRate"
              v-model:bitrate-mode="bitrateMode"
              v-model:keyframe-interval-sec="keyframeIntervalSec"
              v-model:export-alpha="exportAlpha"
              v-model:metadata-title="metadataTitle"
              v-model:metadata-description="metadataDescription"
              v-model:metadata-author="metadataAuthor"
              v-model:metadata-tags="metadataTags"
              v-model:match-timeline="matchTimeline"
              :is-field-dirty="isFieldDirty"
              :reset-field="resetField"
              :show-audio-advanced="true"
              :hide-audio-sample-rate="true"
              :show-metadata="false"
              :show-presets="true"
              :disabled="isExporting"
              :has-audio="true"
            />
          </div>
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
          />
        </div>

        <div v-show="exportType === 'audio'" class="h-px bg-ui-border"></div>

        <div class="space-y-4">
          <UiFormSectionHeader :title="t('videoEditor.export.metadata')" />

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <UiFormField :label="t('videoEditor.export.metadataTitle')">
              <div class="flex items-center gap-1.5 w-full">
                <UiTextInput v-model="metadataTitle" :disabled="isExporting" full-width class="flex-grow" />
                <UButton
                  v-if="isFieldDirty('metadataTitle')"
                  icon="i-heroicons-arrow-path-20-solid"
                  color="warning"
                  variant="ghost"
                  size="xs"
                  @click="resetField('metadataTitle')"
                  class="shrink-0"
                />
              </div>
            </UiFormField>
            <UiFormField :label="t('videoEditor.export.metadataAuthor')">
              <div class="flex items-center gap-1.5 w-full">
                <UiTextInput v-model="metadataAuthor" :disabled="isExporting" full-width class="flex-grow" />
                <UButton
                  v-if="isFieldDirty('metadataAuthor')"
                  icon="i-heroicons-arrow-path-20-solid"
                  color="warning"
                  variant="ghost"
                  size="xs"
                  @click="resetField('metadataAuthor')"
                  class="shrink-0"
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
                @click="resetField('metadataDescription')"
                class="shrink-0 mt-2"
              />
            </div>
          </UiFormField>

          <UiFormField :label="t('videoEditor.export.metadataTags')">
            <div class="flex items-center gap-1.5 w-full">
              <UiTextInput v-model="metadataTags" :disabled="isExporting || (exportType === 'audio' && audioCodec === 'pcm')" full-width class="flex-grow" />
              <UButton
                v-if="isFieldDirty('metadataTags')"
                icon="i-heroicons-arrow-path-20-solid"
                color="warning"
                variant="ghost"
                size="xs"
                @click="resetField('metadataTags')"
                class="shrink-0"
              />
            </div>
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
          <span class="text-ui-text text-sm">{{ t('videoEditor.export.saveAsDefault') }}</span>
        </label>

        <div
          v-if="exportError"
          class="p-3 text-sm text-error-400 bg-error-400/10 rounded-md border border-error-400/20"
        >
          {{ exportError }}
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
