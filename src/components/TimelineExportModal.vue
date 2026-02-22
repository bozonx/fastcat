<script setup lang="ts">
import { computed, watch } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import MediaEncodingSettings, {
  type FormatOption,
} from '~/components/media/MediaEncodingSettings.vue';
import AppModal from '~/components/ui/AppModal.vue';
import { BASE_VIDEO_CODEC_OPTIONS, resolveVideoCodecOptions } from '~/utils/webcodecs';
import {
  useTimelineExport,
  sanitizeBaseName,
  resolveExportCodecs,
  getExt,
} from '~/composables/timeline/useTimelineExport';
import { useI18n } from 'vue-i18n';
import { useToast } from '#imports';

interface Props {
  open: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  exported: [];
}>();

const { t } = useI18n();
const toast = useToast();
const projectStore = useProjectStore();

const {
  isExporting,
  exportProgress,
  exportError,
  exportPhase,
  outputFilename,
  filenameError,
  outputFormat,
  videoCodec,
  bitrateMbps,
  excludeAudio,
  audioCodec,
  audioBitrateKbps,
  exportWidth,
  exportHeight,
  exportFps,
  videoCodecSupport,
  isLoadingCodecSupport,
  ext,
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
} = useTimelineExport();

const isOpen = computed({
  get: () => props.open,
  set: (v) => emit('update:open', v),
});

function getFormatOptions(): readonly FormatOption[] {
  return [
    { value: 'mp4', label: 'MP4' },
    { value: 'webm', label: 'WebM' },
    { value: 'mkv', label: 'MKV' },
  ];
}

function getVideoCodecOptions() {
  return resolveVideoCodecOptions(BASE_VIDEO_CODEC_OPTIONS, videoCodecSupport.value);
}

function getAudioCodecLabel() {
  if (outputFormat.value === 'webm' || outputFormat.value === 'mkv') return 'Opus';
  return audioCodec.value === 'opus' ? 'Opus' : 'AAC';
}

function getPhaseLabel() {
  if (exportPhase.value === 'encoding') return t('videoEditor.export.phaseEncoding', 'Encoding');
  if (exportPhase.value === 'saving') return t('videoEditor.export.phaseSaving', 'Saving');
  return '';
}

watch(
  () => props.open,
  async (val) => {
    if (!val) return;

    exportError.value = null;
    filenameError.value = null;
    exportProgress.value = 0;
    exportPhase.value = null;
    isExporting.value = false;

    await loadCodecSupport();

    outputFormat.value = projectStore.projectSettings.export.encoding.format;
    videoCodec.value = projectStore.projectSettings.export.encoding.videoCodec;
    bitrateMbps.value = projectStore.projectSettings.export.encoding.bitrateMbps;
    excludeAudio.value = projectStore.projectSettings.export.encoding.excludeAudio;
    audioCodec.value = projectStore.projectSettings.export.encoding.audioCodec;
    audioBitrateKbps.value = projectStore.projectSettings.export.encoding.audioBitrateKbps;
    exportWidth.value = projectStore.projectSettings.export.width;
    exportHeight.value = projectStore.projectSettings.export.height;
    exportFps.value = projectStore.projectSettings.export.fps;

    await ensureExportDir();
    await preloadExportIndex();
    const timelineBase = sanitizeBaseName(
      projectStore.currentFileName || projectStore.currentProjectName || 'timeline',
    );
    outputFilename.value = await getNextAvailableFilename(
      timelineBase,
      getExt(outputFormat.value),
    );
    await validateFilename();
  },
);

watch(outputFormat, async (fmt) => {
  const codecConfig = resolveExportCodecs(fmt, videoCodec.value, audioCodec.value);
  videoCodec.value = codecConfig.videoCodec;
  audioCodec.value = codecConfig.audioCodec;

  if (!props.open) return;

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
  if (!props.open) return;
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

  try {
    const exportDir = await ensureExportDir();
    const ok = await validateFilename();
    if (!ok) return;

    try {
      await exportDir.getFileHandle(outputFilename.value);
      throw new Error('A file with this name already exists');
    } catch (e: any) {
      if (e?.name !== 'NotFoundError') {
        throw e;
      }
    }

    let fileHandle: FileSystemFileHandle;
    try {
      fileHandle = await exportDir.getFileHandle(outputFilename.value, { create: true });
    } catch (e: any) {
      if (e?.name === 'NotAllowedError' || e?.name === 'InvalidModificationError') {
        throw new Error('A file with this name already exists', { cause: e });
      }
      throw e;
    }

    const resolvedCodecs = resolveExportCodecs(
      outputFormat.value,
      videoCodec.value,
      audioCodec.value as 'aac' | 'opus',
    );

    projectStore.projectSettings.export.width = normalizedExportWidth.value;
    projectStore.projectSettings.export.height = normalizedExportHeight.value;
    projectStore.projectSettings.export.fps = normalizedExportFps.value;
    projectStore.projectSettings.export.encoding.format = outputFormat.value;
    projectStore.projectSettings.export.encoding.videoCodec = resolvedCodecs.videoCodec;
    projectStore.projectSettings.export.encoding.bitrateMbps = bitrateMbps.value;
    projectStore.projectSettings.export.encoding.excludeAudio = excludeAudio.value;
    projectStore.projectSettings.export.encoding.audioCodec = resolvedCodecs.audioCodec;
    projectStore.projectSettings.export.encoding.audioBitrateKbps = audioBitrateKbps.value;
    await projectStore.saveProjectSettings();

    exportPhase.value = 'encoding';
    await exportTimelineToFile(
      {
        format: outputFormat.value,
        videoCodec: resolvedCodecs.videoCodec,
        bitrate: bitrateBps.value,
        audioBitrate: audioBitrateKbps.value * 1000,
        audio: !excludeAudio.value,
        audioCodec: resolvedCodecs.audioCodec,
        width: normalizedExportWidth.value,
        height: normalizedExportHeight.value,
        fps: normalizedExportFps.value,
      },
      fileHandle,
      (progress) => {
        exportProgress.value = progress;
      },
    );
    rememberExportedFilename(outputFilename.value);

    toast.add({
      title: t('videoEditor.export.successTitle', 'Export successful'),
      description: t('videoEditor.export.successDesc', 'Timeline exported to {file}', {
        file: outputFilename.value,
      }),
      color: 'success',
      icon: 'i-heroicons-check-circle',
    });

    emit('exported');
    isOpen.value = false;
  } catch (err: any) {
    console.error('Export failed:', err);
    if (err?.name === 'AbortError') {
      exportError.value = t('videoEditor.export.errorCancelled', 'Export was cancelled');
    } else {
      exportError.value =
        err?.message || t('videoEditor.export.errorGeneric', 'An error occurred during export');
    }
  } finally {
    isExporting.value = false;
    exportPhase.value = null;
  }
}
</script>

<template>
  <AppModal
    v-model:open="isOpen"
    :prevent-close="isExporting"
    :title="t('videoEditor.export.title', 'Export Timeline')"
    :ui="{ content: 'sm:max-w-lg' }"
  >
    <div class="flex flex-col gap-6">
      <div class="flex flex-col gap-1.5">
        <UFormField :label="t('videoEditor.export.filename', 'Filename')" :error="filenameError ?? undefined">
          <UInput
            v-model="outputFilename"
            class="w-full"
            :disabled="isExporting"
            :placeholder="t('videoEditor.export.filenamePlaceholder', 'e.g. video.mp4')"
          />
        </UFormField>
        <div class="text-xs text-gray-500 flex items-center gap-1.5 mt-1">
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

      <div class="grid grid-cols-2 gap-4">
        <UFormField :label="t('videoEditor.export.width', 'Width')">
          <UInput
            v-model.number="exportWidth"
            type="number"
            inputmode="numeric"
            min="1"
            step="1"
            class="w-full"
            :disabled="isExporting"
          />
        </UFormField>
        <UFormField :label="t('videoEditor.export.height', 'Height')">
          <UInput
            v-model.number="exportHeight"
            type="number"
            inputmode="numeric"
            min="1"
            step="1"
            class="w-full"
            :disabled="isExporting"
          />
        </UFormField>
      </div>

      <UFormField :label="t('videoEditor.export.fps', 'FPS')">
        <UInput
          v-model.number="exportFps"
          type="number"
          inputmode="numeric"
          min="1"
          step="1"
          class="w-full"
          :disabled="isExporting"
        />
      </UFormField>

      <MediaEncodingSettings
        v-model:output-format="outputFormat"
        v-model:video-codec="videoCodec"
        v-model:bitrate-mbps="bitrateMbps"
        v-model:exclude-audio="excludeAudio"
        v-model:audio-codec="audioCodec"
        v-model:audio-bitrate-kbps="audioBitrateKbps"
        :disabled="isExporting"
        :has-audio="true"
        :is-loading-codec-support="isLoadingCodecSupport"
        :format-options="getFormatOptions()"
        :video-codec-options="getVideoCodecOptions()"
      />

      <div
        v-if="exportError"
        class="p-3 text-sm text-red-400 bg-red-400/10 rounded-md border border-red-400/20"
      >
        {{ exportError }}
      </div>
    </div>

    <template #footer>
      <div class="flex flex-col gap-3 w-full">
        <div v-if="isExporting" class="flex flex-col gap-2">
          <div class="flex justify-between text-xs text-gray-400">
            <span class="font-medium">{{ getPhaseLabel() }}</span>
            <span class="font-mono">{{ Math.round(exportProgress * 100) }}%</span>
          </div>
          <UProgress :value="exportProgress * 100" />
          <p class="text-xs text-gray-500 text-center mt-1">
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
            @click="isExporting ? cancelExport() : isOpen = false"
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
    </template>
  </AppModal>
</template>
