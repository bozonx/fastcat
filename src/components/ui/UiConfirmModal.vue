<script setup lang="ts">
import AppModal from '~/components/ui/AppModal.vue';

// We define the specific colors supported by UButton to ensure type safety
type ButtonColor = 'primary' | 'secondary' | 'neutral' | 'error' | 'warning' | 'success' | 'info';

const {
  title,
  description,
  confirmText,
  cancelText,
  color = 'primary',
  icon,
  loading = false,
} = defineProps<{
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  color?: ButtonColor;
  icon?: string;
  loading?: boolean;
}>();

const emit = defineEmits(['confirm']);

const isOpen = defineModel<boolean>('open', { required: true });

const { t } = useI18n();

const handleConfirm = () => {
  emit('confirm');
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
      <UButton :color="color" :loading="loading" @click="handleConfirm">
        {{ confirmText || t('common.confirm') }}
      </UButton>
    </template>
  </AppModal>
</template>
