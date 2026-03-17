<script setup lang="ts">
import { ref } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useUiStore } from '~/stores/ui.store';
import { useFocusStore } from '~/stores/focus.store';
import type { FsEntry } from '~/types/fs';
import FileManagerPanel from '~/components/file-manager/FileManagerPanel.vue';
import ProjectHistory from '~/components/project/ProjectHistory.vue';
import ProjectEffects from '~/components/project/ProjectEffects.vue';
import UiTabs from '~/components/ui/UiTabs.vue';

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

const tabOptions = computed(() => [
  { value: 'files', label: t('videoEditor.fileManager.tabs.files', 'Files') },
  { value: 'effects', label: t('videoEditor.fileManager.tabs.effects', 'Effects') },
  { value: 'history', label: t('videoEditor.fileManager.tabs.history', 'History') },
]);

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
      <UiTabs
        v-if="!foldersOnly"
        v-model="activeTab"
        :options="tabOptions"
        border
      />

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
