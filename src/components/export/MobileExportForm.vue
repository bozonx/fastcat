<script setup lang="ts">
import { computed, watch, ref, onMounted } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import {
  useTimelineExport,
  sanitizeBaseName,
  resolveExportCodecs,
  getExt,
} from '~/composables/timeline/useTimelineExport';

const { t } = useI18n();
const projectStore = useProjectStore();
const timelineStore = useTimelineStore();
const toast = useToast();

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
  metadataAuthor,
  metadataTags,
  ensureExportDir,
  preloadExportIndex,
  validateFilename,
  getNextAvailableFilename,
  exportTimelineToFile,
  cancelExport,
  cancelRequested,
  bitrateBps,
  normalizedExportWidth,
  normalizedExportHeight,
  normalizedExportFps,
  loadCodecSupport,
} = useTimelineExport();

const showAdvanced = ref(false);

const formatOptions = [
  { value: 'mp4', label: 'MP4 (H.264)' },
  { value: 'webm', label: 'WebM (VP9)' },
  { value: 'mkv', label: 'MKV (AV1)' },
];

const qualityOptions = [
  { value: 2, label: 'Low (2 Mbps)' },
  { value: 5, label: 'Medium (5 Mbps)' },
  { value: 10, label: 'High (10 Mbps)' },
  { value: 20, label: 'Ultra (20 Mbps)' },
];

onMounted(async () => {
  await loadCodecSupport();

  // Инициализируем настройки из проекта
  outputFormat.value = projectStore.projectSettings.exportDefaults.encoding.format;
  videoCodec.value = projectStore.projectSettings.exportDefaults.encoding.videoCodec;
  bitrateMbps.value = projectStore.projectSettings.exportDefaults.encoding.bitrateMbps;
  excludeAudio.value = projectStore.projectSettings.exportDefaults.encoding.excludeAudio;

  exportWidth.value = projectStore.projectSettings.project.width;
  exportHeight.value = projectStore.projectSettings.project.height;
  exportFps.value = projectStore.projectSettings.project.fps;

  await ensureExportDir();
  await preloadExportIndex();

  const timelineBase = sanitizeBaseName(
    projectStore.currentFileName || projectStore.currentProjectName || 'timeline',
  );
  outputFilename.value = await getNextAvailableFilename(timelineBase, getExt(outputFormat.value));
  await validateFilename();
});

async function handleStartExport() {
  if (isExporting.value) return;

  try {
    const exportDir = await ensureExportDir();
    const ok = await validateFilename();
    if (!ok) return;

    const fileHandle = await exportDir.getFileHandle(outputFilename.value, { create: true });

    const resolvedCodecs = resolveExportCodecs(
      outputFormat.value,
      videoCodec.value,
      audioCodec.value as 'aac' | 'opus',
    );

    await exportTimelineToFile(
      {
        format: outputFormat.value,
        videoCodec: resolvedCodecs.videoCodec,
        bitrate: bitrateBps.value,
        audioBitrate: audioBitrateKbps.value * 1000,
        audio: !excludeAudio.value,
        audioCodec: resolvedCodecs.audioCodec,
        audioSampleRate: audioSampleRate.value,
        width: normalizedExportWidth.value,
        height: normalizedExportHeight.value,
        fps: normalizedExportFps.value,
        bitrateMode: bitrateMode.value,
        keyframeIntervalSec: keyframeIntervalSec.value,
        exportAlpha: exportAlpha.value,
        metadata: {
          title: metadataTitle.value,
          author: metadataAuthor.value,
          tags: metadataTags.value,
        },
      },
      fileHandle,
      (progress) => {
        exportProgress.value = progress;
      },
    );

    toast.add({
      title: t('videoEditor.export.successTitle', 'Export successful'),
      description: outputFilename.value,
      color: 'success',
    });
  } catch (err: any) {
    console.error('Export failed:', err);
    exportError.value = err.message || 'Export failed';
  }
}

function getPhaseLabel() {
  if (exportPhase.value === 'encoding') return 'Encoding...';
  if (exportPhase.value === 'saving') return 'Saving...';
  return 'Processing...';
}
</script>

<template>
  <div class="flex flex-col gap-6 p-4 bg-slate-950 min-h-full">
    <div class="flex flex-col gap-1">
      <h2 class="text-xl font-bold text-white">Export Project</h2>
      <p class="text-xs text-slate-400">Save your work as a video file</p>
    </div>

    <!-- Основные настройки -->
    <div class="space-y-4">
      <UFormField label="Filename" :error="filenameError ?? undefined">
        <UInput v-model="outputFilename" placeholder="video_name" :disabled="isExporting" />
      </UFormField>

      <div class="grid grid-cols-2 gap-4">
        <UFormField label="Format">
          <USelect
            v-model="outputFormat"
            :options="formatOptions"
            class="w-full"
            :disabled="isExporting"
          />
        </UFormField>
        <UFormField label="Bitrate">
          <USelect
            :model-value="bitrateMbps"
            :options="qualityOptions"
            class="w-full"
            :disabled="isExporting"
            @update:model-value="(v) => (bitrateMbps = Number(v))"
          />
        </UFormField>
      </div>

      <div class="bg-slate-900/50 rounded-xl p-3 border border-slate-800 space-y-3">
        <div class="flex items-center justify-between text-xs">
          <span class="text-slate-400">Resolution</span>
          <span class="text-slate-200 font-medium"
            >{{ exportWidth }}x{{ exportHeight }} @ {{ exportFps }}fps</span
          >
        </div>
        <div class="flex items-center justify-between text-xs">
          <span class="text-slate-400">Audio</span>
          <div class="flex items-center gap-2">
            <span class="text-slate-200">{{ excludeAudio ? 'None' : 'Included' }}</span>
            <USwitch v-model="excludeAudio" size="xs" :disabled="isExporting" />
          </div>
        </div>
      </div>
    </div>

    <!-- Продвинутые настройки (скрыты по дефолту) -->
    <div class="border-t border-slate-800 pt-2">
      <button
        class="flex items-center gap-2 text-xs text-slate-500 py-2"
        @click="showAdvanced = !showAdvanced"
      >
        <Icon :name="showAdvanced ? 'lucide:chevron-up' : 'lucide:chevron-down'" class="w-4 h-4" />
        {{ showAdvanced ? 'Hide advanced settings' : 'Show advanced settings' }}
      </button>

      <div v-if="showAdvanced" class="space-y-4 pt-2 animate-in fade-in slide-in-from-top-2">
        <div class="grid grid-cols-2 gap-4">
          <UFormField label="Audio Codec">
            <USelect
              v-model="audioCodec"
              :options="[
                { value: 'aac', label: 'AAC' },
                { value: 'opus', label: 'Opus' },
              ]"
              class="w-full"
              :disabled="isExporting"
            />
          </UFormField>
          <UFormField label="Sample Rate">
            <USelect
              :model-value="audioSampleRate"
              :options="[
                { value: 44100, label: '44.1 kHz' },
                { value: 48000, label: '48 kHz' },
              ]"
              class="w-full"
              :disabled="isExporting"
              @update:model-value="(v) => (audioSampleRate = Number(v))"
            />
          </UFormField>
        </div>
        <UFormField label="Metadata Description">
          <UTextarea
            v-model="metadataTags"
            placeholder="Tags..."
            :rows="2"
            :disabled="isExporting"
          />
        </UFormField>
      </div>
    </div>

    <!-- Прогресс экспорта -->
    <div
      v-if="isExporting"
      class="bg-slate-900 p-4 rounded-xl border border-blue-500/30 shadow-lg shadow-blue-500/5"
    >
      <div class="flex items-center justify-between mb-3">
        <span class="text-sm font-bold text-blue-400">{{ getPhaseLabel() }}</span>
        <span class="text-sm font-mono text-white">{{ Math.round(exportProgress * 100) }}%</span>
      </div>
      <UProgress :value="exportProgress * 100" color="primary" class="h-2" />
      <div class="mt-4 flex justify-between gap-2">
        <UButton
          color="neutral"
          variant="soft"
          size="sm"
          class="flex-1"
          icon="lucide:x"
          label="Cancel"
          :loading="cancelRequested"
          @click="cancelExport"
        />
      </div>
    </div>

    <!-- Ошибки -->
    <div
      v-if="exportError"
      class="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs"
    >
      {{ exportError }}
    </div>

    <!-- Кнопка запуска -->
    <div class="mt-auto pt-6 pb-4">
      <UButton
        block
        size="lg"
        color="primary"
        icon="lucide:download"
        :label="isExporting ? 'Exporting...' : 'Start Export'"
        :loading="isExporting"
        :disabled="!!filenameError || !outputFilename.trim()"
        @click="handleStartExport"
      />
      <p class="text-[10px] text-slate-500 text-center mt-3">
        Do not close the app or lock your screen during export
      </p>
    </div>
  </div>
</template>
