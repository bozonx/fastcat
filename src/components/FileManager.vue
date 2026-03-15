<script setup lang="ts">
import { ref } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useUiStore } from '~/stores/ui.store';
import { useFocusStore } from '~/stores/focus.store';
import type { FsEntry } from '~/types/fs';
import FileManagerPanel from '~/components/file-manager/FileManagerPanel.vue';
import ProjectHistory from '~/components/project/ProjectHistory.vue';
import ProjectEffects from '~/components/project/ProjectEffects.vue';

const _props = defineProps<{
  foldersOnly?: boolean;
  disableSort?: boolean;
  isFilesPage?: boolean;
}>();

const emit = defineEmits<{
  (e: 'select', entry: FsEntry): void;
}>();

const { t } = useI18n();
const projectStore = useProjectStore();
const focusStore = useFocusStore();
const uiStore = useUiStore();

const activeTab = ref('files');

function handleFileManagerFilesSelect(entry: FsEntry) {
  emit('select', entry);
}
</script>

<template>
  <div
    class="panel-focus-frame flex flex-col h-full bg-ui-bg-elevated border-r border-ui-border transition-colors duration-200 min-w-0 overflow-hidden relative"
    :class="{
      'panel-focus-frame--active': focusStore.isPanelFocused('left'),
    }"
    @pointerdown.capture="focusStore.setTempFocus('left')"
  >
    <!-- Content Wrapper -->
    <div
      class="flex flex-col flex-1 min-h-0"
    >
      <!-- Header / Tabs -->
      <div
        v-if="!foldersOnly"
        class="flex items-center gap-4 px-3 py-2 border-b border-ui-border shrink-0 select-none"
      >
        <button
          class="text-xs font-semibold uppercase tracking-wider transition-colors outline-none"
          :class="
            activeTab === 'files' ? 'text-primary-400' : 'text-ui-text-muted hover:text-ui-text'
          "
          @click="activeTab = 'files'"
        >
          {{ t('videoEditor.fileManager.tabs.files', 'Files') }}
        </button>
        <button
          class="text-xs font-semibold uppercase tracking-wider transition-colors outline-none"
          :class="
            activeTab === 'effects' ? 'text-primary-400' : 'text-ui-text-muted hover:text-ui-text'
          "
          @click="activeTab = 'effects'"
        >
          {{ t('videoEditor.fileManager.tabs.effects', 'Effects') }}
        </button>
        <button
          class="text-xs font-semibold uppercase tracking-wider transition-colors outline-none"
          :class="
            activeTab === 'history' ? 'text-primary-400' : 'text-ui-text-muted hover:text-ui-text'
          "
          @click="activeTab = 'history'"
        >
          {{ t('videoEditor.fileManager.tabs.history', 'History') }}
        </button>
      </div>

      <!-- Content -->
      <FileManagerPanel
        v-if="activeTab === 'files' || foldersOnly"
        :folders-only="foldersOnly"
        :is-files-page="isFilesPage"
        :disable-sort="disableSort"
        @select="handleFileManagerFilesSelect"
      />
      <ProjectEffects v-else-if="activeTab === 'effects' && !foldersOnly" class="flex-1 min-h-0" />
      <ProjectHistory v-else-if="activeTab === 'history' && !foldersOnly" class="flex-1 min-h-0" />
    </div>
  </div>
</template>
