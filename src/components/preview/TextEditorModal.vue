<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';
import AppModal from '~/components/ui/AppModal.vue';
import { useProjectStore } from '~/stores/project.store';

const props = defineProps<{
  open: boolean;
  filePath: string;
  fileName: string;
  initialContent: string;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
}>();

const projectStore = useProjectStore();

const content = ref(props.initialContent);
const isSaving = ref(false);
const saveError = ref<string | null>(null);
const lastSavedAt = ref<Date | null>(null);
const lastSavedContent = ref(props.initialContent);

let saveTimer: number | undefined;

watch(
  () => props.initialContent,
  (val) => {
    content.value = val;
    lastSavedContent.value = val;
    saveError.value = null;
    lastSavedAt.value = null;
  },
);

watch(
  () => props.open,
  (val) => {
    if (val) {
      content.value = props.initialContent;
      lastSavedContent.value = props.initialContent;
      saveError.value = null;
      lastSavedAt.value = null;
    }
  },
);

function clearTimer() {
  if (saveTimer) {
    window.clearTimeout(saveTimer);
    saveTimer = undefined;
  }
}

async function saveNow() {
  clearTimer();
  if (!props.filePath) return;
  if (content.value === lastSavedContent.value) return;

  isSaving.value = true;
  saveError.value = null;
  try {
    const handle = await projectStore.getFileHandleByPath(props.filePath);
    if (!handle) {
      saveError.value = 'File handle not found';
      return;
    }

    if (typeof (handle as any).createWritable !== 'function') {
      saveError.value = 'Writing is not supported';
      return;
    }

    const writable = await (handle as any).createWritable();
    await writable.write(content.value);
    await writable.close();

    lastSavedContent.value = content.value;
    lastSavedAt.value = new Date();
  } catch (e) {
    console.error('TextEditorModal: failed to save file', e);
    saveError.value = 'Failed to save file';
  } finally {
    isSaving.value = false;
  }
}

function scheduleSave() {
  clearTimer();
  saveTimer = window.setTimeout(() => {
    void saveNow();
  }, 800);
}

watch(
  content,
  () => {
    scheduleSave();
  },
  { flush: 'post' },
);

onUnmounted(() => {
  clearTimer();
  void saveNow();
});

function handleClose() {
  emit('update:open', false);
}
</script>

<template>
  <AppModal
    :open="props.open"
    :title="props.fileName"
    :ui="{ content: 'max-w-4xl h-[80vh]' }"
    @update:open="emit('update:open', $event)"
  >
    <div class="flex flex-col h-full min-h-0">
      <div class="flex items-center justify-between px-1 py-2 text-xs shrink-0">
        <span class="text-ui-text-muted">Autosave enabled</span>
        <span v-if="isSaving" class="text-ui-text">Saving...</span>
        <span v-else-if="saveError" class="text-red-400">{{ saveError }}</span>
        <span v-else-if="lastSavedAt" class="text-ui-text-muted">
          Saved at
          {{ lastSavedAt?.toLocaleTimeString?.() || '' }}
        </span>
        <span v-else class="text-ui-text-muted">No changes</span>
      </div>

      <textarea
        v-model="content"
        class="flex-1 w-full resize-none font-mono text-sm text-ui-text bg-ui-bg focus:outline-none p-4 rounded border border-ui-border"
        spellcheck="false"
      />
    </div>
  </AppModal>
</template>
