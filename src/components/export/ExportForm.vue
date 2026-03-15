<script setup lang="ts">
import { computed, watch, ref } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useUiStore } from '~/stores/ui.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useFocusStore } from '~/stores/focus.store';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import MediaEncodingSettings, {
  type FormatOption,
} from '~/components/media/MediaEncodingSettings.vue';
import MediaResolutionSettings from '~/components/media/MediaResolutionSettings.vue';
import { BASE_VIDEO_CODEC_OPTIONS, resolveVideoCodecOptions } from '~/utils/webcodecs';
import {
  useTimelineExport,
  sanitizeBaseName,
  resolveExportCodecs,
  getExt,
} from '~/composables/timeline/export';

const emit = defineEmits<{
  exported: [];
}>();

const { t } = useI18n();
const toast = useToast();
const projectStore = useProjectStore();
const uiStore = useUiStore();
const timelineStore = useTimelineStore();
const focusStore = useFocusStore();
const saveAsDefaults = ref(false);
const exportOnlySelectionRange = ref(true);

function focusExportForm() {
  focusStore.setPanelFocus('exportForm');
}

const selectionRange = computed(() => timelineStore.getSelectionRange());
const hasSelectionRange = computed(() => Boolean(selectionRange.value));

const {
  isExporting,
  exportProgress,
  exportError,
  exportPhase,
  exportWarnings,
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
  videoCodecSupport,
  isLoadingCodecSupport,
  bitrateBps,
  normalizedExportWidth,
  normalizedExportHeight,
  normalizedExportFps,
  ensureExportDir,
  preloadExportIndex,
  validateFilename,
  getNextAvailableFilename,
  rememberExportedFilename,
  loadCodecSupport,
  exportTimelineToFile,
  cancelExport,
  cancelRequested,
} = useTimelineExport();

function getFormatOptions(): readonly FormatOption[] {
  return [
    { value: 'mp4', label: 'MP4' },
    { value: 'webm', label: 'WEBM' },
    { value: 'mkv', label: 'MKV (AV1)' },
  ];
}

function getVideoCodecOptions() {
  return resolveVideoCodecOptions(BASE_VIDEO_CODEC_OPTIONS, videoCodecSupport.value);
}

function getPhaseLabel() {
  if (exportPhase.value === 'encoding') return t('videoEditor.export.phaseEncoding', 'Encoding');
  if (exportPhase.value === 'saving') return t('videoEditor.export.phaseSaving', 'Saving');
  return '';
}

watch(
  () => projectStore.currentView,
  async (val) => {
    if (val !== 'export') return;

    exportError.value = null;
    exportWarnings.value = [];
    filenameError.value = null;
    exportProgress.value = 0;
    exportPhase.value = null;
    isExporting.value = false;
    cancelRequested.value = false;
    saveAsDefaults.value = false;
    exportOnlySelectionRange.value = true;

    await loadCodecSupport();

    outputFormat.value = projectStore.projectSettings.exportDefaults.encoding.format;
    videoCodec.value = projectStore.projectSettings.exportDefaults.encoding.videoCodec;
    bitrateMbps.value = projectStore.projectSettings.exportDefaults.encoding.bitrateMbps;
    excludeAudio.value = projectStore.projectSettings.exportDefaults.encoding.excludeAudio;
    audioCodec.value = projectStore.projectSettings.exportDefaults.encoding.audioCodec;
    audioBitrateKbps.value = projectStore.projectSettings.exportDefaults.encoding.audioBitrateKbps;
    audioSampleRate.value = projectStore.projectSettings.project.sampleRate;
    bitrateMode.value = projectStore.projectSettings.exportDefaults.encoding.bitrateMode;
    keyframeIntervalSec.value =
      projectStore.projectSettings.exportDefaults.encoding.keyframeIntervalSec;
    exportAlpha.value = projectStore.projectSettings.exportDefaults.encoding.exportAlpha;
    exportAlpha.value = projectStore.projectSettings.exportDefaults.encoding.exportAlpha;
    metadataTitle.value = projectStore.projectMeta?.title || '';
    metadataDescription.value = projectStore.projectMeta?.description || '';
    metadataAuthor.value = projectStore.projectMeta?.author || '';
    metadataTags.value = projectStore.projectMeta?.tags.join(', ') || '';
    exportWidth.value = projectStore.projectSettings.project.width;
    exportHeight.value = projectStore.projectSettings.project.height;
    exportFps.value = projectStore.projectSettings.project.fps;
    resolutionFormat.value = projectStore.projectSettings.project.resolutionFormat;
    orientation.value = projectStore.projectSettings.project.orientation;
    aspectRatio.value = projectStore.projectSettings.project.aspectRatio;
    isCustomResolution.value = projectStore.projectSettings.project.isCustomResolution;

    await ensureExportDir();
    await preloadExportIndex();
    const timelineBase = sanitizeBaseName(
      projectStore.currentFileName || projectStore.currentProjectName || 'timeline',
    );
    outputFilename.value = await getNextAvailableFilename(timelineBase, getExt(outputFormat.value));
    await validateFilename();
  },
  { immediate: true },
);

watch(outputFormat, async (fmt) => {
  const codecConfig = resolveExportCodecs(fmt, videoCodec.value, audioCodec.value);
  videoCodec.value = codecConfig.videoCodec;
  audioCodec.value = codecConfig.audioCodec;

  if (projectStore.currentView !== 'export') return;

  try {
    const base = outputFilename.value.replace(/\.[^.]+$/, '');
    const nextExt = getExt(fmt);

    if (!base) return;

    if (!/_\d{3}$/.test(base)) {
      outputFilename.value = await getNextAvailableFilename(base, nextExt);
      return;
    }

    outputFilename.value = `${base}.${nextExt}`;
    await validateFilename();
  } catch {
    // ignore
  }
});

watch(outputFilename, async () => {
  if (projectStore.currentView !== 'export') return;
  try {
    await validateFilename();
  } catch {
    // ignore
  }
});

async function handleConfirm() {
  if (isExporting.value) return;

  isExporting.value = true;
  exportProgress.value = 0;
  exportError.value = null;
  exportWarnings.value = [];

  try {
    const exportDir = await ensureExportDir();
    const ok = await validateFilename();
    if (!ok) return;

    try {
      await exportDir.getFileHandle(outputFilename.value);
      throw new Error('A file with this name already exists');
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'NotFoundError') {
        throw e;
      }
    }

    let fileHandle: FileSystemFileHandle;
    try {
      fileHandle = await exportDir.getFileHandle(outputFilename.value, { create: true });
    } catch (e: unknown) {
      if (
        e instanceof Error &&
        (e.name === 'NotAllowedError' || e.name === 'InvalidModificationError')
      ) {
        throw new Error('A file with this name already exists', { cause: e });
      }
      throw e;
    }

    const resolvedCodecs = resolveExportCodecs(
      outputFormat.value,
      videoCodec.value,
      audioCodec.value as 'aac' | 'opus',
    );

    let exportSuccess = false;
    try {
      if (saveAsDefaults.value) {
        projectStore.projectSettings.project.width = normalizedExportWidth.value;
        projectStore.projectSettings.project.height = normalizedExportHeight.value;
        projectStore.projectSettings.project.fps = normalizedExportFps.value;
        projectStore.projectSettings.project.resolutionFormat = resolutionFormat.value;
        projectStore.projectSettings.project.orientation = orientation.value;
        projectStore.projectSettings.project.aspectRatio = aspectRatio.value;
        projectStore.projectSettings.project.isCustomResolution = isCustomResolution.value;
        projectStore.projectSettings.exportDefaults.encoding.format = outputFormat.value;
        projectStore.projectSettings.exportDefaults.encoding.videoCodec = resolvedCodecs.videoCodec;
        projectStore.projectSettings.exportDefaults.encoding.bitrateMbps = bitrateMbps.value;
        projectStore.projectSettings.exportDefaults.encoding.excludeAudio = excludeAudio.value;
        projectStore.projectSettings.exportDefaults.encoding.audioCodec = resolvedCodecs.audioCodec;
        projectStore.projectSettings.exportDefaults.encoding.audioBitrateKbps =
          audioBitrateKbps.value;
        projectStore.projectSettings.exportDefaults.encoding.bitrateMode = bitrateMode.value;
        projectStore.projectSettings.exportDefaults.encoding.keyframeIntervalSec =
          keyframeIntervalSec.value;
        projectStore.projectSettings.exportDefaults.encoding.exportAlpha = exportAlpha.value;

        await projectStore.saveProjectSettings();

        await projectStore.saveProjectMeta({
          title: metadataTitle.value,
          description: metadataDescription.value,
          author: metadataAuthor.value,
          tags: metadataTags.value
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
        });
      }

      exportPhase.value = 'encoding';
      await exportTimelineToFile(
        {
          format: outputFormat.value,
          videoCodec: resolvedCodecs.videoCodec,
          bitrate: bitrateBps.value,
          audioBitrate: audioBitrateKbps.value * 1000,
          audio: !excludeAudio.value,
          audioCodec: resolvedCodecs.audioCodec,
          audioSampleRate: projectStore.projectSettings.project.sampleRate,
          width: normalizedExportWidth.value,
          height: normalizedExportHeight.value,
          fps: normalizedExportFps.value,
          bitrateMode: bitrateMode.value,
          keyframeIntervalSec: keyframeIntervalSec.value,
          exportAlpha: exportAlpha.value,
          metadata: {
            title: metadataTitle.value,
            description: metadataDescription.value,
            author: metadataAuthor.value,
            tags: metadataTags.value,
          },
          exportRangeUs:
            hasSelectionRange.value && exportOnlySelectionRange.value
              ? (selectionRange.value ?? undefined)
              : undefined,
        },
        fileHandle,
        (progress) => {
          exportProgress.value = progress;
        },
      );

      exportSuccess = true;
      rememberExportedFilename(outputFilename.value);

      if (exportWarnings.value.length > 0) {
        toast.add({
          title: t('videoEditor.export.warningTitle', 'Export warnings'),
          description: exportWarnings.value[0]!,
          color: 'warning',
          icon: 'i-heroicons-exclamation-triangle',
        });
      }

      toast.add({
        title: t('videoEditor.export.successTitle', 'Export successful'),
        description: t('videoEditor.export.successDesc', {
          file: outputFilename.value,
        }),
        color: 'success',
        icon: 'i-heroicons-check-circle',
      });

      const fileManager = useFileManager();
      await fileManager.reloadDirectory('_export');
      uiStore.notifyFileManagerUpdate();

      emit('exported');
    } finally {
      if (!exportSuccess) {
        try {
          await exportDir.removeEntry(outputFilename.value);
        } catch (e) {
          console.warn('Failed to clean up partial export file', e);
        }
        await preloadExportIndex(); // Reload cache since file was deleted
        await validateFilename(); // Update validation UI
      }
    }
  } catch (err: unknown) {
    console.error('Export failed:', err);
    if (err instanceof Error && err.name === 'AbortError') {
      exportError.value = t('videoEditor.export.errorCancelled', 'Export was cancelled');
    } else {
      exportError.value =
        err instanceof Error ? err.message : t('videoEditor.export.error', 'Export failed');
    }
  } finally {
    isExporting.value = false;
    exportPhase.value = null;
    cancelRequested.value = false;
  }
}
</script>

<template>
  <div
    class="panel-focus-frame flex flex-col h-full bg-ui-bg-elevated p-6 overflow-y-auto custom-scrollbar"
    :class="{
      'panel-focus-frame--active': focusStore.isPanelFocused('exportForm'),
    }"
    @pointerdown.capture="focusExportForm"
  >
    <div class="mb-6 flex items-center justify-between">
      <h2 class="text-xl font-semibold text-ui-text">
        {{ t('videoEditor.export.title', 'Export Timeline') }}
      </h2>
    </div>

    <div class="flex flex-col gap-6 max-w-2xl">
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
              <span class="text-sm font-medium text-ui-text">
                {{ t('videoEditor.export.onlySelectionRange', 'Export only selected zone') }}
              </span>
              <span class="text-xs text-ui-text-muted">
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
        <UFormField
          :label="t('videoEditor.export.filename', 'Filename')"
          :error="filenameError ?? undefined"
        >
          <UInput
            v-model="outputFilename"
            class="w-full"
            :disabled="isExporting"
            :placeholder="t('videoEditor.export.filenamePlaceholder', 'e.g. video.mp4')"
          />
        </UFormField>
        <div class="text-xs text-ui-text-muted flex items-center gap-1.5 mt-1">
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

      <MediaEncodingSettings
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
        :show-metadata="true"
        :disabled="isExporting"
        :has-audio="true"
        :is-loading-codec-support="isLoadingCodecSupport"
        :format-options="getFormatOptions()"
        :video-codec-options="getVideoCodecOptions()"
      />

      <label class="flex items-center gap-3 cursor-pointer mt-2">
        <UCheckbox v-model="saveAsDefaults" :disabled="isExporting" />
        <span class="text-sm text-ui-text">{{
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

    <div class="mt-8 pt-6 border-t border-ui-border">
      <div class="flex flex-col gap-3 w-full">
        <div v-if="isExporting" class="flex flex-col gap-2">
          <div class="flex justify-between text-xs text-ui-text-muted">
            <span class="font-medium">{{ getPhaseLabel() }}</span>
            <span class="font-mono">{{ Math.round(exportProgress * 100) }}%</span>
          </div>
          <UProgress :value="exportProgress * 100" />
          <p class="text-xs text-ui-text-muted text-center mt-1">
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
            color="neutral"
            variant="ghost"
            :label="t('common.cancel', 'Cancel')"
            :loading="cancelRequested"
            :disabled="cancelRequested"
            @click="isExporting ? cancelExport() : undefined"
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
            @click="handleConfirm"
          />
        </div>
      </div>
    </div>
  </div>
</template>
