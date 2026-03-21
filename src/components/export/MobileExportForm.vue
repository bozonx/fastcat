<script setup lang="ts">
import { useProjectStore } from '~/stores/project.store';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
import UiTextInput from '~/components/ui/UiTextInput.vue';
import { computed, ref, onMounted } from 'vue';
import { useExportForm } from '~/composables/timeline/export/useExportForm';

const { t } = useI18n();
const projectStore = useProjectStore();

const {
  isExporting,
  exportProgress,
  exportError,
  outputFilename,
  filenameError,
  outputFormat,
  bitrateMbps,
  excludeAudio,
  audioCodec,
  audioBitrateKbps,
  audioSampleRate,
  exportWidth,
  exportHeight,
  exportFps,
  metadataTitle,
  metadataDescription,
  metadataAuthor,
  metadataTags,
  normalizedExportWidth,
  normalizedExportHeight,
  normalizedExportFps,

  initializeExportForm,
  handleStartExport,
  getPhaseLabel,
  cancelExport,
  cancelRequested,
} = useExportForm();

const showAdvanced = ref(false);
const exportLocation = computed(() =>
  projectStore.currentProjectName
    ? `${projectStore.currentProjectName}/exports`
    : 'Project exports',
);

const exportSummary = computed(() => {
  const audioPart = excludeAudio.value ? 'No audio' : `${audioCodec.value.toUpperCase()} audio`;
  return `${outputFormat.value.toUpperCase()} • ${normalizedExportWidth.value}x${normalizedExportHeight.value} • ${normalizedExportFps.value} fps • ${audioPart}`;
});

const formatOptions = computed(() => [
  { value: 'mp4', label: 'MP4 (H.264)' },
  { value: 'webm', label: 'WebM (VP9)' },
  { value: 'mkv', label: 'MKV (AV1)' },
]);

const qualityOptions = computed(() => [
  { value: 2, label: `${t('videoEditor.settings.blurQualityLow')} (2 Mbps)` },
  { value: 5, label: `${t('videoEditor.settings.brightnessModeNormal')} (5 Mbps)` },
  { value: 10, label: `${t('videoEditor.settings.blurQualityHigh')} (10 Mbps)` },
  { value: 20, label: `${t('videoEditor.settings.blurQualityUltra')} (20 Mbps)` },
]);

onMounted(async () => {
  await initializeExportForm();
});

async function onStartExport() {
  await handleStartExport();
}
</script>

<template>
  <div class="flex min-h-full flex-col gap-6 bg-slate-950 p-4">
    <div class="flex flex-col gap-1">
      <h2 class="text-xl font-bold text-white">{{ $t('videoEditor.export.exportProject') }}</h2>
      <p class="text-xs text-slate-400">{{ $t('videoEditor.export.saveWorkDescription') }}</p>
    </div>

    <div class="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <p class="text-[11px] uppercase tracking-[0.18em] text-slate-500">
        {{ $t('videoEditor.export.summary') }}
      </p>
      <p class="mt-2 text-sm font-medium text-white">{{ exportSummary }}</p>
      <p class="mt-1 text-xs text-slate-500">
        {{ $t('videoEditor.export.savedTo', { location: exportLocation }) }}
      </p>
    </div>

    <!-- Main Settings -->
    <div class="space-y-4">
      <UFormField :label="$t('videoEditor.export.filename')" :error="filenameError ?? undefined">
        <UiTextInput
          v-model="outputFilename"
          placeholder="video_name"
          :disabled="isExporting"
          full-width
        />
      </UFormField>

      <div class="grid grid-cols-2 gap-4">
        <UFormField :label="$t('videoEditor.export.outputFormat')">
          <UiSelect
            v-model="outputFormat"
            :items="formatOptions"
            value-key="value"
            label-key="label"
            full-width
            :disabled="isExporting"
          />
        </UFormField>
        <UFormField :label="$t('videoEditor.export.videoBitrate')">
          <UiSelect
            :model-value="bitrateMbps"
            :items="qualityOptions"
            value-key="value"
            label-key="label"
            full-width
            :disabled="isExporting"
            @update:model-value="
              (v: unknown) => (bitrateMbps = Number((v as { value: number })?.value ?? v))
            "
          />
        </UFormField>
      </div>

      <div class="space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-3">
        <div class="flex items-center justify-between text-xs">
          <span class="text-slate-400">{{ $t('videoEditor.export.resolution') }}</span>
          <span class="text-slate-200 font-medium"
            >{{ exportWidth }}x{{ exportHeight }} @ {{ exportFps }}fps</span
          >
        </div>
        <div class="flex items-center justify-between text-xs">
          <span class="text-slate-400">{{ $t('common.audio') }}</span>
          <div class="flex items-center gap-2">
            <span class="text-slate-200">{{
              excludeAudio ? $t('common.disabled') : $t('common.enabled')
            }}</span>
            <USwitch v-model="excludeAudio" size="xs" :disabled="isExporting" />
          </div>
        </div>
        <div class="flex items-center justify-between text-xs">
          <span class="text-slate-400">{{ $t('videoEditor.export.estimatedQuality') }}</span>
          <span class="font-medium text-slate-200">{{ bitrateMbps }} Mbps</span>
        </div>
      </div>
    </div>

    <!-- Advanced Settings (hidden by default) -->
    <div class="border-t border-slate-800 pt-2">
      <button
        class="flex items-center gap-2 text-xs text-slate-500 py-2"
        @click="showAdvanced = !showAdvanced"
      >
        <Icon :name="showAdvanced ? 'lucide:chevron-up' : 'lucide:chevron-down'" class="w-4 h-4" />
        {{
          showAdvanced
            ? $t('videoEditor.export.hideAdvanced')
            : $t('videoEditor.export.showAdvanced')
        }}
      </button>

      <div v-if="showAdvanced" class="space-y-4 pt-2 animate-in fade-in slide-in-from-top-2">
        <div
          v-if="!excludeAudio"
          class="space-y-4 rounded-xl border border-slate-800/80 bg-slate-900/40 p-3"
        >
          <p class="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
            {{ $t('common.audio') }}
          </p>
          <div class="grid grid-cols-2 gap-4">
            <UFormField :label="$t('videoEditor.export.audioCodec')">
              <UiSelect
                v-model="audioCodec"
                :items="[
                  { value: 'aac', label: $t('videoEditor.export.codec.aac') },
                  { value: 'opus', label: $t('videoEditor.export.codec.opus') },
                ]"
                value-key="value"
                label-key="label"
                full-width
                :disabled="isExporting"
              />
            </UFormField>
            <UFormField :label="$t('videoEditor.audio.sampleRate')">
              <UiSelect
                :model-value="audioSampleRate"
                :items="[
                  { value: 44100, label: '44.1 kHz' },
                  { value: 48000, label: '48 kHz' },
                ]"
                value-key="value"
                label-key="label"
                full-width
                :disabled="isExporting"
                @update:model-value="
                  (v: unknown) => (audioSampleRate = Number((v as { value: number })?.value ?? v))
                "
              />
            </UFormField>
          </div>
          <UFormField :label="$t('videoEditor.export.audioBitrate')">
            <UiWheelNumberInput
              v-model="audioBitrateKbps"
              :min="64"
              :max="512"
              :step="16"
              :disabled="isExporting"
              class="max-w-none"
            >
              <template #trailing>
                <span class="text-xs text-slate-500">kbps</span>
              </template>
            </UiWheelNumberInput>
          </UFormField>
        </div>

        <div class="space-y-4 rounded-xl border border-slate-800/80 bg-slate-900/40 p-3">
          <p class="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
            {{ $t('videoEditor.export.metadata') }}
          </p>
          <div class="grid grid-cols-1 gap-4">
            <UFormField :label="$t('videoEditor.export.metadataTitle')">
              <UiTextInput
                v-model="metadataTitle"
                :placeholder="$t('videoEditor.export.metadataTitle')"
                :disabled="isExporting"
                full-width
              />
            </UFormField>
            <UFormField :label="$t('videoEditor.export.metadataDescription')">
              <UiTextInput
                v-model="metadataDescription"
                :placeholder="$t('videoEditor.export.metadataDescription')"
                :disabled="isExporting"
                full-width
              />
            </UFormField>
            <UFormField :label="$t('videoEditor.export.metadataAuthor')">
              <UiTextInput
                v-model="metadataAuthor"
                :placeholder="$t('videoEditor.export.metadataAuthor')"
                :disabled="isExporting"
                full-width
              />
            </UFormField>
          </div>
          <UFormField :label="$t('videoEditor.export.metadataTags')">
            <UTextarea
              v-model="metadataTags"
              placeholder="tag1, tag2"
              :rows="2"
              :disabled="isExporting"
            />
          </UFormField>
        </div>
      </div>
    </div>

    <!-- Export Progress -->
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
          :label="$t('common.cancel')"
          :loading="cancelRequested"
          @click="cancelExport"
        />
      </div>
    </div>

    <!-- Errors -->
    <div
      v-if="exportError"
      class="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs"
    >
      {{ exportError }}
    </div>

    <!-- Start Button -->
    <div class="mt-auto pt-6 pb-4">
      <UButton
        block
        size="lg"
        color="primary"
        icon="lucide:download"
        :label="
          isExporting ? $t('videoEditor.export.exporting') : $t('videoEditor.export.startExport')
        "
        :loading="isExporting"
        :disabled="!!filenameError || !outputFilename.trim()"
        @click="onStartExport"
      />
      <p class="text-[10px] text-slate-500 text-center mt-3">
        {{ $t('videoEditor.export.keepAppOpenHint') }}
      </p>
    </div>
  </div>
</template>
