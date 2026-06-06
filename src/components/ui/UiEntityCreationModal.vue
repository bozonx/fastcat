<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from 'vue';
import UiModal from '~/components/ui/UiModal.vue';
import UiFormField from '~/components/ui/UiFormField.vue';

const props = defineProps<{
  title: string;
  label?: string;
  placeholder?: string;
  confirmLabel?: string;
  defaultValue?: string;
  loading?: boolean;
  selectWithoutExtension?: boolean;
}>();

const isOpen = defineModel<boolean>('open', { required: true });

const emit = defineEmits<{
  (e: 'confirm', name: string): void;
  (e: 'cancel'): void;
}>();

const { t } = useI18n();

const INPUT_FOCUS_DELAY_MS = 50;

const name = ref(props.defaultValue || '');
const inputRef = ref<HTMLElement | null>(null);

// Reset name when opening and focus/select the input
watch(
  isOpen,
  async (val) => {
    if (val) {
      name.value = props.defaultValue || '';
      await nextTick();
      setTimeout(() => {
        const input =
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (inputRef.value as any)?.$el?.querySelector('input') || (inputRef.value as any)?.input;
        if (input) {
          input.focus();
          const value = name.value;
          if (props.selectWithoutExtension && value) {
            const lastDot = value.lastIndexOf('.');
            if (lastDot > 0) {
              input.setSelectionRange(0, lastDot);
            } else {
              input.select();
            }
          } else {
            input.select();
          }
        }
      }, INPUT_FOCUS_DELAY_MS);
    }
  },
  { immediate: true },
);

onMounted(() => {
  if (isOpen.value) {
    name.value = props.defaultValue || '';
  }
});

function handleConfirm() {
  const trimmed = name.value.trim();
  if (!trimmed || props.loading) return;
  emit('confirm', trimmed);
}

function handleCancel() {
  isOpen.value = false;
  emit('cancel');
}
</script>

<template>
  <UiModal v-model:open="isOpen" :title="title" @close="handleCancel">
    <div class="py-2 px-1">
      <form @submit.prevent="handleConfirm">
        <UiFormField :label="label || t('common.name')">
          <UiTextInput
            ref="inputRef"
            v-model="name"
            full-width
            data-primary-focus="true"
            :placeholder="placeholder || t('common.namePlaceholder')"
            :disabled="loading"
            autocomplete="off"
          />
        </UiFormField>
      </form>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton color="neutral" variant="ghost" :disabled="loading" @click="handleCancel">
          {{ t('common.cancel') }}
        </UButton>
        <UButton
          color="primary"
          :disabled="!name.trim() || loading"
          :loading="loading"
          @click="handleConfirm"
        >
          {{ confirmLabel || t('common.confirm') }}
        </UButton>
      </div>
    </template>
  </UiModal>
</template>
