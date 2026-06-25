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
  validate?: (name: string) => string | boolean | null | undefined;
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
const errorMsg = ref<string | null>(null);

// While true, focusing the input re-applies the base-name selection. This
// outlasts Reka UI's focus-scope refocus (which calls input.select() and would
// otherwise select the whole string when nested focus scopes fight, e.g. a
// rename modal opened inside the mobile asset drawer).
const shouldSelectOnFocus = ref(false);

function resolveInputElement(): HTMLInputElement | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const exposedInput = (inputRef.value as any)?.input;
  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (inputRef.value as any)?.$el?.querySelector('input') ||
    (typeof exposedInput?.value === 'object' ? exposedInput.value : exposedInput) ||
    null
  );
}

/**
 * Selects the relevant part of the input value. When `selectWithoutExtension`
 * is set and the value has an extension, only the base name (before the last
 * dot) is selected; otherwise the whole value is selected.
 */
function applySelection(input: HTMLInputElement) {
  const value = name.value;
  if (props.selectWithoutExtension && value) {
    const lastDot = value.lastIndexOf('.');
    if (lastDot > 0) {
      input.setSelectionRange(0, lastDot);
      return;
    }
  }
  input.select();
}

function focusInput() {
  const input = resolveInputElement();
  if (!input) return;
  input.focus();
  // Defer to a macrotask so the selection runs after Reka UI's synchronous
  // focus-scope `element.select()` call.
  setTimeout(() => applySelection(input), 0);
}

// Re-apply the base-name selection whenever the input gains focus during the
// open phase, deferred so it wins over Reka UI's whole-string select().
function handleInputFocus() {
  if (!shouldSelectOnFocus.value) return;
  const input = resolveInputElement();
  if (!input) return;
  setTimeout(() => applySelection(input), 0);
}

// The user started editing/navigating: stop forcing the selection.
function handleInputKeydown() {
  shouldSelectOnFocus.value = false;
}

// Applies the selection after the modal finished its open animation, so it
// runs after Reka UI's auto-focus.
function handleAfterEnter() {
  focusInput();
}

function runValidation() {
  if (!props.validate) {
    errorMsg.value = null;
    return;
  }
  const result = props.validate(name.value.trim());
  if (typeof result === 'string') {
    errorMsg.value = result;
  } else if (result === false) {
    errorMsg.value = t('common.validation.exists');
  } else {
    errorMsg.value = null;
  }
}

watch(name, () => {
  runValidation();
});

// Reset name when opening and focus/select the input
watch(
  isOpen,
  async (val) => {
    if (val) {
      name.value = props.defaultValue || '';
      errorMsg.value = null;
      shouldSelectOnFocus.value = true;
      await nextTick();
      runValidation();
      // Fallback for environments where the modal's `after:enter` does not fire
      // (e.g. unit tests without transitions).
      setTimeout(() => {
        focusInput();
      }, INPUT_FOCUS_DELAY_MS);
    } else {
      shouldSelectOnFocus.value = false;
    }
  },
  { immediate: true },
);

onMounted(() => {
  if (isOpen.value) {
    name.value = props.defaultValue || '';
    runValidation();
  }
});

function handleConfirm() {
  const trimmed = name.value.trim();
  runValidation();
  if (!trimmed || props.loading || errorMsg.value) return;
  emit('confirm', trimmed);
}

function handleCancel() {
  isOpen.value = false;
  emit('cancel');
}
</script>

<template>
  <UiModal
    v-model:open="isOpen"
    :title="title"
    @close="handleCancel"
    @after:enter="handleAfterEnter"
  >
    <div class="py-2 px-1">
      <form @submit.prevent="handleConfirm">
        <UiFormField :label="label || t('common.name')" :error="errorMsg || undefined">
          <UiTextInput
            ref="inputRef"
            v-model="name"
            full-width
            data-primary-focus="true"
            :placeholder="placeholder || t('common.namePlaceholder')"
            :disabled="loading"
            autocomplete="off"
            :ui="{
              base: errorMsg ? 'ring-2 ring-error-500! border-error-500!' : '',
            }"
            @focus="handleInputFocus"
            @keydown="handleInputKeydown"
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
          :disabled="!name.trim() || loading || !!errorMsg"
          :loading="loading"
          @click="handleConfirm"
        >
          {{ confirmLabel || t('common.confirm') }}
        </UButton>
      </div>
    </template>
  </UiModal>
</template>
