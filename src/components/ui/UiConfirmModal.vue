<script setup lang="ts">
import UiModal from '~/components/ui/UiModal.vue';

// We define the specific colors supported by UButton to ensure type safety
type ButtonColor = 'primary' | 'secondary' | 'neutral' | 'error' | 'warning' | 'success' | 'info';

const props = withDefaults(defineProps<{
  title: string;
  description?: string;
  confirmText?: string;
  secondaryText?: string;
  cancelText?: string;
  color?: ButtonColor;
  secondaryColor?: ButtonColor;
  icon?: string;
  loading?: boolean;
}>(), {
  description: undefined,
  confirmText: undefined,
  secondaryText: undefined,
  cancelText: undefined,
  color: 'primary',
  secondaryColor: 'neutral',
  icon: undefined,
  loading: false,
});

const emit = defineEmits(['confirm', 'secondary']);

const isOpen = defineModel<boolean>('open', { required: true });

const confirmButtonRef = ref<any>(null);

function focusConfirmButton() {
  const el = confirmButtonRef.value?.$el || confirmButtonRef.value;
  if (!(el instanceof HTMLElement)) {
    return;
  }

  nextTick(() => {
    setTimeout(() => {
      el.focus();
    }, 0);
  });
}

const handleAfterEnter = () => {
  focusConfirmButton();
};

watch(isOpen, (newValue) => {
  if (newValue) {
    focusConfirmButton();
  }
});

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
  <UiModal
    v-model:open="isOpen"
    :title="props.title"
    :ui="{ content: 'sm:max-w-lg' }"
    @after:enter="handleAfterEnter"
  >
    <div class="flex flex-col gap-4">
      <div v-if="props.icon || props.description" class="flex gap-4">
        <div v-if="props.icon" class="shrink-0">
          <UIcon
            :name="props.icon"
            class="w-6 h-6"
            :class="{
              'text-primary-500': props.color === 'primary',
              'text-error-500': props.color === 'error',
              'text-warning-500': props.color === 'warning',
              'text-success-500': props.color === 'success',
              'text-info-500': props.color === 'info',
              'text-ui-text-muted': props.color === 'neutral' || props.color === 'secondary',
            }"
          />
        </div>
        <div v-if="props.description" class="flex-1">
          <p class="text-sm text-ui-text-muted">
            {{ props.description }}
          </p>
        </div>
      </div>

      <div v-if="$slots.default" class="w-full">
        <slot />
      </div>
    </div>

    <template #footer>
      <UButton color="neutral" variant="ghost" @click="handleClose">
        {{ props.cancelText || t('common.cancel') }}
      </UButton>
      <UButton
        v-if="props.secondaryText"
        :color="props.secondaryColor"
        variant="ghost"
        :disabled="props.loading"
        @click="handleSecondary"
      >
        {{ props.secondaryText }}
      </UButton>
      <UButton
        ref="confirmButtonRef"
        :color="props.color"
        :loading="props.loading"
        autofocus
        @click="handleConfirm"
      >
        {{ props.confirmText || t('common.confirm') }}
      </UButton>
    </template>
  </UiModal>
</template>
