<script setup lang="ts">
import { computed, ref } from 'vue';
import UiModal from '~/components/ui/UiModal.vue';

/**
 * Modal for configuring automatic montage (silence trimming) based on STT data.
 */

const { t } = useI18n();

const props = defineProps<{
  open: boolean;
  hasMissingTranscription?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'apply', settings: {
    trimStart: boolean;
    trimEnd: boolean;
    trimMiddle: boolean;
    mode: 'cut' | 'mark';
  }): void;
}>();

const isOpen = computed({
  get: () => props.open,
  set: (v) => emit('update:open', v),
});

const trimStart = ref(false);
const trimEnd = ref(false);
const trimMiddle = ref(false);
const mode = ref<'cut' | 'mark'>('cut');

function handleApply() {
  emit('apply', {
    trimStart: trimStart.value,
    trimEnd: trimEnd.value,
    trimMiddle: trimMiddle.value,
    mode: mode.value,
  });
  isOpen.value = false;
}
</script>

<template>
  <UiModal
    v-model:open="isOpen"
    :title="t('fastcat.timeline.autoMontage.title')"
    :description="t('fastcat.timeline.autoMontage.description')"
    :ui="{ content: 'sm:max-w-md' }"
  >
    <div class="flex flex-col gap-4 py-2">
      <UAlert
        v-if="hasMissingTranscription"
        color="warning"
        variant="subtle"
        icon="i-heroicons-exclamation-triangle"
        :title="t('fastcat.timeline.autoMontage.noTranscription')"
      />

      <div class="flex flex-col gap-2">
        <UCheckbox
          v-model="trimStart"
          :label="t('fastcat.timeline.autoMontage.trimStart')"
          :ui="{ label: 'text-sm' }"
        />
        <UCheckbox
          v-model="trimEnd"
          :label="t('fastcat.timeline.autoMontage.trimEnd')"
          :ui="{ label: 'text-sm' }"
        />
        <UCheckbox
          v-model="trimMiddle"
          :label="t('fastcat.timeline.autoMontage.trimMiddle')"
          :ui="{ label: 'text-sm' }"
        />
      </div>

      <div class="flex flex-col gap-3">
        <label class="text-xs font-semibold uppercase tracking-wider text-ui-text-muted">
          {{ t('fastcat.timeline.autoMontage.mode') }}
        </label>
        <div class="flex gap-1 p-1 bg-ui-bg-accent rounded-lg w-fit">
          <UButton
            :color="mode === 'cut' ? 'primary' : 'neutral'"
            :variant="mode === 'cut' ? 'solid' : 'ghost'"
            size="xs"
            class="px-3"
            @click="mode = 'cut'"
          >
            {{ t('fastcat.timeline.autoMontage.modeCut') }}
          </UButton>
          <UButton
            :color="mode === 'mark' ? 'primary' : 'neutral'"
            :variant="mode === 'mark' ? 'solid' : 'ghost'"
            size="xs"
            class="px-3"
            @click="mode = 'mark'"
          >
            {{ t('fastcat.timeline.autoMontage.modeMark') }}
          </UButton>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton color="neutral" variant="ghost" @click="isOpen = false">
          {{ t('common.cancel') }}
        </UButton>
        <UButton color="primary" @click="handleApply">
          {{ t('fastcat.timeline.autoMontage.apply') }}
        </UButton>
      </div>
    </template>
  </UiModal>
</template>
