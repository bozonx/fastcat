<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed, nextTick } from 'vue';

const props = defineProps<{
  initialName: string;
  isFolder: boolean;
  existingNames: string[];
}>();

const emit = defineEmits<{
  (e: 'save', newName: string): void;
  (e: 'cancel'): void;
}>();

const { t } = useI18n();
const toast = useToast();

const inputRef = ref<HTMLInputElement | null>(null);
const currentName = ref(props.initialName);

const invalidCharsRegex = /[<>:"/\\|?*]/;

const isInvalid = computed(() => {
  const name = currentName.value.trim();
  if (!name) return true;
  if (invalidCharsRegex.test(name)) return true;
  if (name !== props.initialName && props.existingNames.includes(name)) return true;
  return false;
});

let isFinished = false;
let isReady = false;
// Timer used to debounce blur so context menu closing doesn't trigger cancel.
let blurTimer: ReturnType<typeof setTimeout> | null = null;

function focusAndSelectName() {
  if (!inputRef.value) return;

  inputRef.value.focus({ preventScroll: true });
  inputRef.value.scrollIntoView({ block: 'nearest', inline: 'nearest' });

  if (!props.isFolder) {
    const lastDot = props.initialName.lastIndexOf('.');
    if (lastDot > 0) {
      inputRef.value.setSelectionRange(0, lastDot);
    } else {
      inputRef.value.select();
    }
    return;
  }

  inputRef.value.select();
}

onMounted(() => {
  nextTick(() => {
    focusAndSelectName();

    // Context menus often restore focus to their trigger element when closing.
    // We wait for that to finish, then assert focus again and mark as ready.
    setTimeout(() => {
      focusAndSelectName();
      isReady = true;
    }, 200);
  });
});

onBeforeUnmount(() => {
  if (blurTimer !== null) {
    clearTimeout(blurTimer);
    blurTimer = null;
  }
});

function onBlur() {
  if (!isReady) {
    // If blurred before ready (e.g. by context menu closing), just re-focus
    focusAndSelectName();
    return;
  }

  // Delay finish so that if focus immediately returns we don't cancel
  blurTimer = setTimeout(() => {
    blurTimer = null;
    finish();
  }, 150);
}

function onFocus() {
  // Cancel any pending blur-finish when focus returns to the input.
  if (blurTimer !== null) {
    clearTimeout(blurTimer);
    blurTimer = null;
  }
}

function finish() {
  if (isFinished) return;
  isFinished = true;

  const name = currentName.value.trim();

  if (!name) {
    toast.add({
      color: 'error',
      title: t('common.rename', 'Rename'),
      description: t('common.validation.required', 'Name is required.'),
    });
    emit('cancel');
    return;
  }

  if (invalidCharsRegex.test(name)) {
    toast.add({
      color: 'error',
      title: t('common.rename', 'Rename'),
      description: t('common.validation.invalidName', 'Name contains invalid characters.'),
    });
    emit('cancel');
    return;
  }

  if (name !== props.initialName && props.existingNames.includes(name)) {
    toast.add({
      color: 'error',
      title: t('common.rename', 'Rename'),
      description: t('common.validation.exists', 'Name already exists.'),
    });
    emit('cancel');
    return;
  }

  if (name === props.initialName) {
    emit('cancel');
    return;
  }

  emit('save', name);
}

function cancel() {
  if (isFinished) return;
  isFinished = true;
  emit('cancel');
}
</script>

<template>
  <input
    ref="inputRef"
    v-model="currentName"
    type="text"
    class="text-sm bg-ui-bg-elevated text-ui-text px-1 py-0 border rounded-sm outline-hidden w-full max-w-50"
    :class="isInvalid ? 'border-red-500' : 'border-primary-500'"
    @keydown.enter="finish"
    @keydown.esc="cancel"
    @blur="onBlur"
    @focus="onFocus"
    @click.stop
    @dblclick.stop
  />
</template>
