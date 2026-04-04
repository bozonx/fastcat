<script setup lang="ts">
import { ref, computed, shallowRef, watch, provide, onMounted } from 'vue';
import { Pane, Splitpanes } from 'splitpanes';
import FileBrowser from '~/components/file-manager/FileBrowser.vue';
import FileManagerPanel from '~/components/file-manager/FileManagerPanel.vue';
import PropertiesPanel from '~/components/layout-panels/PropertiesPanel.vue';
import { useFilesPageFileManagerStore } from '~/stores/file-manager.store';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { BloggerDogVfsAdapter } from '~/file-manager/core/vfs/bloggerdog.adapter';
import { resolveExternalServiceConfig } from '~/utils/external-integrations';
import type { FsEntry } from '~/types/fs';
import type { SelectedEntity } from '~/stores/selection.store';

interface Props {
  sizes: number[];
  selectedEntity: SelectedEntity | null;
}

defineProps<Props>();

const emit = defineEmits<{
  (e: 'resized', event: { panes: Array<{ size: number }> }): void;
  (e: 'selectFolder', entry: FsEntry | null): void;
  (e: 'clearSelection'): void;
}>();

const { t } = useI18n();
const projectStore = useProjectStore();
const workspaceStore = useWorkspaceStore();
const runtimeConfig = useRuntimeConfig();
const fileManagerStore = useFilesPageFileManagerStore();

provide('fileManagerStore', fileManagerStore);

const bloggerDogVfs = computed(() => {
  const bloggerDogApiUrl = typeof runtimeConfig.public.bloggerDogApiUrl === 'string' 
    ? runtimeConfig.public.bloggerDogApiUrl 
    : '';
  
  const config = resolveExternalServiceConfig({
    service: 'files',
    integrations: workspaceStore.userSettings.integrations,
    bloggerDogApiUrl
  });
  
  if (!config) return null;

  return new BloggerDogVfsAdapter(() => ({
    baseUrl: config.baseUrl,
    bearerToken: config.bearerToken
  }));
});

onMounted(() => {
  if (!fileManagerStore.selectedFolder) {
    fileManagerStore.openFolder({
        name: projectStore.currentProjectName || 'Project',
        path: '',
        kind: 'directory',
    });
  }
});
</script>

<template>
  <div class="h-full w-full">
    <Splitpanes
      v-if="fileManagerStore.isBloggerDogPanelVisible"
      key="with-bloggerdog"
      class="editor-splitpanes"
    >
      <Pane :size="25" min-size="10" class="border-r border-ui-border">
        <FileBrowser 
          v-if="bloggerDogVfs"
          :remote-mode-only="true" 
          :vfs="bloggerDogVfs"
          class="h-full" 
        />
        <div v-else class="h-full flex items-center justify-center text-ui-text-dim text-sm p-4 text-center">
          {{ t('fastcat.fileManager.remote.not_configured') }}
        </div>
      </Pane>
      <Pane :size="75">
        <Splitpanes
          key="inner-with-bd"
          class="editor-splitpanes h-full"
          @resized="(event: { panes: Array<{ size: number }> }) => emit('resized', event)"
        >
          <Pane :size="sizes[0]" min-size="10">
            <FileManagerPanel
              folders-only
              is-files-page
              class="h-full"
              @select="(entry) => fileManagerStore.openFolder(entry)"
            />
          </Pane>
          <Pane :size="sizes[1]" min-size="10">
            <FileBrowser class="h-full" />
          </Pane>
          <Pane :size="sizes[2]" min-size="10">
            <PropertiesPanel
              :entity="selectedEntity"
              class="h-full"
              @clear-selection="emit('clearSelection')"
            />
          </Pane>
        </Splitpanes>
      </Pane>
    </Splitpanes>

    <Splitpanes
      v-else
      key="no-bloggerdog"
      class="editor-splitpanes"
      @resized="(event: { panes: Array<{ size: number }> }) => emit('resized', event)"
    >
      <Pane :size="sizes[0]" min-size="10">
        <FileManagerPanel
          folders-only
          is-files-page
          class="h-full"
          @select="(entry) => fileManagerStore.openFolder(entry)"
        />
      </Pane>
      <Pane :size="sizes[1]" min-size="10">
        <FileBrowser class="h-full" />
      </Pane>
      <Pane :size="sizes[2]" min-size="10">
        <PropertiesPanel
          :entity="selectedEntity"
          class="h-full"
          @clear-selection="emit('clearSelection')"
        />
      </Pane>
    </Splitpanes>
  </div>
</template>
