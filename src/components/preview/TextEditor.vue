<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import TextEditorModal from '~/components/preview/TextEditorModal.vue';
import { useProjectStore } from '~/stores/project.store';
import { useFocusStore, type PanelFocusId } from '~/stores/focus.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';

const props = defineProps<{
  filePath: string;
  fileName?: string;
  focusPanelId?: PanelFocusId;
}>();

const projectStore = useProjectStore();
const focusStore = useFocusStore();
const fm = useFileManager();

const content = ref('');
const isSaving = ref(false);
const saveError = ref<string | null>(null);
const lastSavedAt = ref<Date | null>(null);
const lastSavedContent = ref('');
const isModalOpen = defineModel<boolean>('isModalOpen', { default: false });
const isLoading = ref(true);

let saveTimer: number | undefined;

onMounted(async () => {
  if (!props.filePath) {
    isLoading.value = false;
    return;
  }

  try {
    const blob = await fm.vfs.readFile(props.filePath);
    const text = await blob.text();
    content.value = text;
    lastSavedContent.value = text;
  } catch (e) {
    console.error('TextEditor: failed to read file', e);
    saveError.value = 'Failed to read file';
  } finally {
    isLoading.value = false;
  }
});

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
    console.error('TextEditor: failed to save file', e);
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

function focusPanel() {
  if (!props.focusPanelId) return;
  focusStore.setPanelFocus(props.focusPanelId);
}
</script>

<template>
  <div
    class="flex flex-col h-full w-full bg-ui-bg relative group/text-editor"
    @pointerdown.capture="focusPanel"
  >
    <textarea
      v-if="!isLoading"
      v-model="content"
      class="flex-1 w-full resize-none font-mono text-sm text-ui-text bg-ui-bg focus:outline-none p-4"
      spellcheck="false"
      @focus="focusPanel"
    />
    <div v-else class="flex-1 flex items-center justify-center text-ui-text-muted text-sm">
      Loading...
    </div>

    <!-- Status indicators & Modal button (bottom-right) -->
    <div
      class="absolute bottom-4 right-4 flex items-center gap-2 transition-opacity opacity-0 group-hover/text-editor:opacity-100"
    >
      <div
        v-if="isSaving || saveError || lastSavedAt"
        class="px-2 py-1 rounded bg-ui-bg-elevated/80 backdrop-blur-sm border border-ui-border text-2xs text-ui-text-muted select-none"
      >
        <span v-if="isSaving">Saving...</span>
        <span v-else-if="saveError" class="text-red-400">{{ saveError }}</span>
        <span v-else-if="lastSavedAt">Saved {{ lastSavedAt?.toLocaleTimeString?.() }}</span>
      </div>

      <UButton
        icon="i-heroicons-arrows-pointing-out"
        variant="solid"
        size="xs"
        color="neutral"
        class="shadow-lg"
        @click="isModalOpen = true"
      />
    </div>

    <TextEditorModal
      v-model:open="isModalOpen"
      v-model:content="content"
      :file-path="props.filePath"
      :file-name="props.fileName || 'Text Editor'"
      :is-saving="isSaving"
      :save-error="saveError"
      :last-saved-at="lastSavedAt"
    />
  </div>
</template>
