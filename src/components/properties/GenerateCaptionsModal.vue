<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import AppModal from '~/components/ui/AppModal.vue';
import { useTimelineStore } from '~/stores/timeline.store';
import {
  createDefaultCaptionGenerationSettings,
  type CaptionGenerationSettings,
} from '~/utils/transcription/captions';
import type { TranscriptionCacheRecord } from '~/repositories/transcription-cache.repository';

const props = defineProps<{
  open: boolean;
  trackId: string;
}>();

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'generated'): void;
}>();

const { t } = useI18n();
const toast = useToast();
const timelineStore = useTimelineStore();

const isOpen = computed({
  get: () => props.open,
  set: (value: boolean) => emit('update:open', value),
});

const records = ref<TranscriptionCacheRecord[]>([]);
const selectedKey = ref('');
const isLoading = ref(false);
const isGenerating = ref(false);
const settings = ref<CaptionGenerationSettings>(createDefaultCaptionGenerationSettings());

const selectedRecord = computed(
  () => records.value.find((record) => record.key === selectedKey.value) ?? null,
);

const selectItems = computed(() =>
  records.value.map((record) => ({
    label: `${record.sourceName} · ${record.language || 'auto'} · ${new Date(record.createdAt).toLocaleString()}`,
    value: record.key,
  })),
);

function resetState() {
  settings.value = createDefaultCaptionGenerationSettings();
}

async function loadRecords() {
  if (!isOpen.value) return;

  isLoading.value = true;
  try {
    const nextRecords = await timelineStore.listCachedTranscriptions();
    records.value = nextRecords;
    selectedKey.value = nextRecords[0]?.key ?? '';
  } catch (error: unknown) {
    records.value = [];
    selectedKey.value = '';
    toast.add({
      color: 'red',
      title: t('common.error', 'Error'),
      description: error instanceof Error ? error.message : 'Failed to load transcription cache',
    });
  } finally {
    isLoading.value = false;
  }
}

async function generateCaptions() {
  if (!selectedKey.value) return;

  isGenerating.value = true;
  try {
    const result = await timelineStore.generateCaptionsFromCache({
      trackId: props.trackId,
      transcriptionKey: selectedKey.value,
      settings: {
        maxWordsPerClip: Math.max(1, Math.round(settings.value.maxWordsPerClip)),
        maxDurationMs: Math.max(100, Math.round(settings.value.maxDurationMs)),
        silenceGapMs: Math.max(0, Math.round(settings.value.silenceGapMs)),
        splitOnPunctuation: Boolean(settings.value.splitOnPunctuation),
      },
    });

    toast.add({
      color: 'success',
      title: t('granVideoEditor.captions.generated', 'Captions generated'),
      description: t(
        'granVideoEditor.captions.generatedDescription',
        `${result.addedCount} text clips were created from ${result.sourceName}`,
      ),
    });
    emit('generated');
    isOpen.value = false;
  } catch (error: unknown) {
    toast.add({
      color: 'red',
      title: t('common.error', 'Error'),
      description: error instanceof Error ? error.message : 'Failed to generate captions',
    });
  } finally {
    isGenerating.value = false;
  }
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      resetState();
      await loadRecords();
    }
  },
);
</script>

<template>
  <AppModal
    v-model:open="isOpen"
    :title="t('granVideoEditor.captions.modalTitle', 'Generate captions')"
    :description="
      t(
        'granVideoEditor.captions.modalDescription',
        'Create text clips from an existing transcription cache record. Transcription is not started here.',
      )
    "
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-1.5">
        <span class="text-xs text-ui-text-muted">
          {{ t('granVideoEditor.captions.cacheRecord', 'Transcription cache') }}
        </span>
        <USelectMenu
          :model-value="selectedKey"
          :items="selectItems"
          value-key="value"
          label-key="label"
          size="sm"
          :loading="isLoading"
          :disabled="isLoading || records.length === 0"
          @update:model-value="(value: string) => (selectedKey = value)"
        />
        <span v-if="selectedRecord" class="text-[11px] text-ui-text-muted">
          {{ selectedRecord.sourcePath }}
        </span>
        <span v-else-if="!isLoading" class="text-[11px] text-ui-text-muted">
          {{ t('granVideoEditor.captions.noCache', 'No prepared transcription cache records found') }}
        </span>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div class="flex flex-col gap-1.5">
          <span class="text-xs text-ui-text-muted">
            {{ t('granVideoEditor.captions.maxWordsPerClip', 'Max words per clip') }}
          </span>
          <UInput
            :model-value="String(settings.maxWordsPerClip)"
            type="number"
            min="1"
            max="20"
            @update:model-value="(value) => (settings.maxWordsPerClip = Number(value) || 1)"
          />
        </div>

        <div class="flex flex-col gap-1.5">
          <span class="text-xs text-ui-text-muted">
            {{ t('granVideoEditor.captions.maxDurationMs', 'Max clip duration, ms') }}
          </span>
          <UInput
            :model-value="String(settings.maxDurationMs)"
            type="number"
            min="100"
            step="50"
            @update:model-value="(value) => (settings.maxDurationMs = Number(value) || 100)"
          />
        </div>

        <div class="flex flex-col gap-1.5">
          <span class="text-xs text-ui-text-muted">
            {{ t('granVideoEditor.captions.silenceGapMs', 'Split on silence gap, ms') }}
          </span>
          <UInput
            :model-value="String(settings.silenceGapMs)"
            type="number"
            min="0"
            step="10"
            @update:model-value="(value) => (settings.silenceGapMs = Number(value) || 0)"
          />
        </div>

        <div class="flex items-end">
          <UCheckbox
            :model-value="settings.splitOnPunctuation"
            :label="t('granVideoEditor.captions.splitOnPunctuation', 'Split on punctuation')"
            @update:model-value="(value) => (settings.splitOnPunctuation = Boolean(value))"
          />
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton color="neutral" variant="ghost" @click="isOpen = false">
          {{ t('common.cancel', 'Cancel') }}
        </UButton>
        <UButton
          color="primary"
          :disabled="!selectedKey || isLoading"
          :loading="isGenerating"
          @click="generateCaptions"
        >
          {{ t('granVideoEditor.captions.generate', 'Generate captions') }}
        </UButton>
      </div>
    </template>
  </AppModal>
</template>
