<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import UiModal from '~/components/ui/UiModal.vue';

const props = defineProps<{
  title: string;
  confirmLabel?: string;
  defaultValue?: string;
}>();

const isOpen = defineModel<boolean>('modelValue', { required: true });

const emit = defineEmits<{
  (e: 'confirm', name: string): void;
}>();

const name = ref(props.defaultValue || '');
const inputRef = ref<any>(null);

watch(() => isOpen.value, (open) => {
  if (open) {
    name.value = props.defaultValue || '';
    nextTick(() => {
      setTimeout(() => {
        inputRef.value?.input?.focus();
      }, 100);
    });
  }
});

function handleConfirm() {
  if (!name.value.trim()) return;
  emit('confirm', name.value.trim());
}

function handleCancel() {
  isOpen.value = false;
}
</script>

<template>
  <UiModal
    v-model:open="isOpen"
    :title="props.title"
  >
    <div class="py-2">
      <UFormGroup :label="$t('common.name', 'Name')" name="name">
        <UInput
          ref="inputRef"
          v-model="name"
          @keydown.enter="handleConfirm"
        />
      </UFormGroup>
    </div>

    <template #footer>
      <UButton
        color="neutral"
        variant="ghost"
        @click="handleCancel"
      >
        {{ $t('common.cancel', 'Cancel') }}
      </UButton>
      <UButton
        color="primary"
        :disabled="!name.trim()"
        @click="handleConfirm"
      >
        {{ props.confirmLabel || $t('common.confirm', 'Confirm') }}
      </UButton>
    </template>
  </UiModal>
</template>
