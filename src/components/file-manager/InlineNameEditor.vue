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
  const input = inputRef.value;
  if (!input) return;

  input.focus({ preventScroll: true });
  input.scrollIntoView({ block: 'nearest', inline: 'nearest' });

  if (!props.isFolder) {
    const lastDot = props.initialName.lastIndexOf('.');
    if (lastDot > 0) {
      input.setSelectionRange(0, lastDot);
    } else {
      input.select();
    }
  } else {
    input.select();
  }
}

onMounted(() => {
  nextTick(() => {
    focusAndSelectName();

    // Context menus often restore focus to their trigger element when closing.
    // We wait for that to finish, then assert focus again and mark as ready.
    setTimeout(() => {
      focusAndSelectName();
      isReady = true;
    }, 100);
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
      title: t('common.rename'),
      description: t('common.validation.required'),
    });
    emit('cancel');
    return;
  }

  if (invalidCharsRegex.test(name)) {
    toast.add({
      color: 'error',
      title: t('common.rename'),
      description: t('common.validation.invalidName'),
    });
    emit('cancel');
    return;
  }

  if (name !== props.initialName && props.existingNames.includes(name)) {
    toast.add({
      color: 'error',
      title: t('common.rename'),
      description: t('common.validation.exists'),
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
    class="bg-ui-bg-elevated border rounded px-1 min-w-10 max-w-full text-sm font-mono outline-none transition-shadow"
    :class="[isInvalid ? 'border-red-500 ring-1 ring-red-500' : 'border-primary-500']"
    :style="{ width: `${Math.max(4, currentName.length + 2)}ch` }"
    @keydown.enter.stop="finish"
    @keydown.esc.stop="cancel"
    @blur="onBlur"
    @focus="onFocus"
    @click.stop
    @dblclick.stop
  />
</template>
