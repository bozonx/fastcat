<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import AppModal from '~/components/ui/AppModal.vue';
import { useTimelineStore } from '~/stores/timeline.store';
import {
  createDefaultCaptionGenerationSettings,
  type CaptionGenerationSettings,
} from '~/utils/transcription/captions';

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

const isGenerating = ref(false);
const settings = ref<CaptionGenerationSettings>(createDefaultCaptionGenerationSettings());

function resetState() {
  settings.value = createDefaultCaptionGenerationSettings();
}

async function generateCaptions() {
  isGenerating.value = true;
  try {
    const result = await timelineStore.generateCaptionsFromTimeline({
      trackId: props.trackId,
      settings: {
        maxWordsPerClip: Math.max(1, Math.round(settings.value.maxWordsPerClip)),
        maxDurationMs: Math.max(100, Math.round(settings.value.maxDurationMs)),
        silenceGapMs: Math.max(0, Math.round(settings.value.silenceGapMs)),
        splitOnPunctuation: Boolean(settings.value.splitOnPunctuation),
      },
    });

    toast.add({
      color: 'success',
      title: t('fastcat.captions.generated', 'Captions generated'),
      description: t(
        'fastcat.captions.generatedDescription',
        `${result.addedCount} text clips were created from ${result.sourceCount} source files`,
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
  (open) => {
    if (open) {
      resetState();
    }
  },
);
</script>

<template>
  <AppModal
    v-model:open="isOpen"
    :title="t('fastcat.captions.modalTitle', 'Generate captions')"
    :description="
      t(
        'fastcat.captions.modalDescription',
        'Create text clips from transcription cache of active audio and video clips across the timeline.',
      )
    "
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <div class="flex flex-col gap-4">
      <div class="text-xs text-ui-text-muted bg-ui-bg-elevated rounded border border-ui-border p-3">
        {{
          t(
            'fastcat.captions.timelineWideDescription',
            'The editor will scan all active audio and video media clips on non-muted, visible tracks, load their existing transcription cache, account for trims, and keep only the top visible source on overlaps.',
          )
        }}
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div class="flex flex-col gap-1.5">
          <span class="text-xs text-ui-text-muted">
            {{ t('fastcat.captions.maxWordsPerClip', 'Max words per clip') }}
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
            {{ t('fastcat.captions.maxDurationMs', 'Max clip duration, ms') }}
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
            {{ t('fastcat.captions.silenceGapMs', 'Split on silence gap, ms') }}
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
            :label="t('fastcat.captions.splitOnPunctuation', 'Split on punctuation')"
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
        <UButton color="primary" :loading="isGenerating" @click="generateCaptions">
          {{ t('fastcat.captions.generate', 'Generate captions') }}
        </UButton>
      </div>
    </template>
  </AppModal>
</template>
