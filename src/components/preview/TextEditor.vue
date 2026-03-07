<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';
import TextEditorModal from '~/components/preview/TextEditorModal.vue';
import { useProjectStore } from '~/stores/project.store';
import { useFocusStore, type PanelFocusId } from '~/stores/focus.store';

const props = defineProps<{
  filePath: string;
  fileName?: string;
  initialContent: string;
  focusPanelId?: PanelFocusId;
}>();

const projectStore = useProjectStore();
const focusStore = useFocusStore();

const content = ref(props.initialContent);
const isSaving = ref(false);
const saveError = ref<string | null>(null);
const lastSavedAt = ref<Date | null>(null);
const lastSavedContent = ref(props.initialContent);
const isModalOpen = ref(false);

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
  <div class="flex flex-col h-full w-full bg-ui-bg" @pointerdown.capture="focusPanel">
    <div class="flex items-center justify-between px-3 py-2 border-b border-ui-border text-xs">
      <div class="flex items-center gap-2">
        <span class="text-ui-text-muted">Autosave enabled</span>
        <UButton
          icon="i-heroicons-arrows-pointing-out"
          variant="ghost"
          size="xs"
          color="neutral"
          title="Open in modal"
          @click="isModalOpen = true"
        />
      </div>
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
      class="flex-1 w-full resize-none font-mono text-sm text-ui-text bg-ui-bg focus:outline-none p-4"
      spellcheck="false"
      @focus="focusPanel"
    />

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
