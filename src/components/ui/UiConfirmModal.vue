<script setup lang="ts">
import AppModal from '~/components/ui/AppModal.vue';

// We define the specific colors supported by UButton to ensure type safety
type ButtonColor = 'primary' | 'secondary' | 'neutral' | 'error' | 'warning' | 'success' | 'info';

const {
  title,
  description,
  confirmText,
  secondaryText,
  cancelText,
  color = 'primary',
  secondaryColor = 'neutral',
  icon,
  loading = false,
} = defineProps<{
  title: string;
  description?: string;
  confirmText?: string;
  secondaryText?: string;
  cancelText?: string;
  color?: ButtonColor;
  secondaryColor?: ButtonColor;
  icon?: string;
  loading?: boolean;
}>();

const emit = defineEmits(['confirm', 'secondary']);

const isOpen = defineModel<boolean>('open', { required: true });

const { t } = useI18n();

const handleConfirm = () => {
  // Use a slight delay to allow the active button click event to run to completion
  // before the parent component tears down the modal DOM. This prevents "Cannot read properties of null (reading nextSibling)"
  setTimeout(() => {
    emit('confirm');
  }, 0);
};

const handleSecondary = () => {
  setTimeout(() => {
    emit('secondary');
  }, 0);
};

const handleClose = () => {
  isOpen.value = false;
};
</script>

<template>
  <AppModal v-model:open="isOpen" :title="title" :ui="{ content: 'sm:max-w-lg' }">
    <div class="flex flex-col gap-4">
      <div v-if="icon || description" class="flex gap-4">
        <div v-if="icon" class="shrink-0">
          <UIcon
            :name="icon"
            class="w-6 h-6"
            :class="{
              'text-primary-500': color === 'primary',
              'text-error-500': color === 'error',
              'text-warning-500': color === 'warning',
              'text-success-500': color === 'success',
              'text-info-500': color === 'info',
              'text-ui-text-muted': color === 'neutral' || color === 'secondary',
            }"
          />
        </div>
        <div v-if="description" class="flex-1">
          <p class="text-sm text-ui-text-muted">
            {{ description }}
          </p>
        </div>
      </div>

      <div v-if="$slots.default" class="w-full">
        <slot />
      </div>
    </div>

    <template #footer>
      <UButton color="neutral" variant="ghost" @click="handleClose">
        {{ cancelText || t('common.cancel') }}
      </UButton>
      <UButton
        v-if="secondaryText"
        :color="secondaryColor"
        variant="ghost"
        :disabled="loading"
        @click="handleSecondary"
      >
        {{ secondaryText }}
      </UButton>
      <UButton :color="color" :loading="loading" @click="handleConfirm">
        {{ confirmText || t('common.confirm') }}
      </UButton>
    </template>
  </AppModal>
</template>
