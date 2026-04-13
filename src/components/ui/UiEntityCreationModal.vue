<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue';
import { useWindowSize } from '@vueuse/core';
import UiModal from '~/components/ui/UiModal.vue';
import UiMobileDrawer from '~/components/ui/UiMobileDrawer.vue';
import UiFormField from '~/components/ui/UiFormField.vue';

const props = defineProps<{
  title: string;
  label?: string;
  placeholder?: string;
  confirmLabel?: string;
  defaultValue?: string;
  loading?: boolean;
}>();

const isOpen = defineModel<boolean>('open', { required: true });

const emit = defineEmits<{
  (e: 'confirm', name: string): void;
  (e: 'cancel'): void;
}>();

const { t } = useI18n();
const { width } = useWindowSize();
const isMobile = computed(() => width.value < 768);

const name = ref(props.defaultValue || '');
const inputRef = ref<any>(null);

// Reset name when opening
watch(isOpen, (val) => {
  if (val) {
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
  <component
    :is="isMobile ? UiMobileDrawer : UiModal"
    v-model:open="isOpen"
    :title="title"
    @close="handleCancel"
  >
    <div class="py-2 px-1">
      <form @submit.prevent="handleConfirm">
        <UiFormField :label="label || t('common.name')">
          <UInput
            ref="inputRef"
            v-model="name"
            class="w-full"
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
  </component>
</template>
