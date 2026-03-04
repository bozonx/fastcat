<script setup lang="ts">
import { ref, onMounted, computed, nextTick } from 'vue';

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

onMounted(() => {
  nextTick(() => {
    if (inputRef.value) {
      inputRef.value.focus();
      // Scroll into view
      inputRef.value.scrollIntoView({ block: 'nearest', inline: 'nearest' });

      if (!props.isFolder) {
        const lastDot = props.initialName.lastIndexOf('.');
        if (lastDot > 0) {
          inputRef.value.setSelectionRange(0, lastDot);
        } else {
          inputRef.value.select();
        }
      } else {
        inputRef.value.select();
      }
    }
  });
});

function finish() {
  if (isFinished) return;
  isFinished = true;

  const name = currentName.value.trim();

  if (!name) {
    toast.add({
      color: 'red',
      title: t('common.rename', 'Rename'),
      description: t('common.validation.required', 'Name is required.'),
    });
    emit('cancel');
    return;
  }

  if (invalidCharsRegex.test(name)) {
    toast.add({
      color: 'red',
      title: t('common.rename', 'Rename'),
      description: t('common.validation.invalidName', 'Name contains invalid characters.'),
    });
    emit('cancel');
    return;
  }

  if (name !== props.initialName && props.existingNames.includes(name)) {
    toast.add({
      color: 'red',
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
    class="text-sm bg-ui-bg-elevated text-ui-text px-1 py-0 border rounded-sm outline-hidden w-full max-w-[200px]"
    :class="isInvalid ? 'border-red-500' : 'border-primary-500'"
    @keydown.enter="finish"
    @keydown.esc="cancel"
    @blur="finish"
    @click.stop
    @dblclick.stop
  />
</template>
