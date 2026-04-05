<script setup lang="ts">
import { ref, computed, shallowRef, watch, provide, onMounted } from 'vue';
import { Pane, Splitpanes } from 'splitpanes';
import FileBrowser from '~/components/file-manager/FileBrowser.vue';
import FileManagerPanel from '~/components/file-manager/FileManagerPanel.vue';
import ComputerFileManager from '~/components/file-manager/ComputerFileManager.vue';
import PropertiesPanel from '~/components/layout-panels/PropertiesPanel.vue';
import { useFilesPageFileManagerStore } from '~/stores/file-manager.store';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useUiStore } from '~/stores/ui.store';
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
const uiStore = useUiStore();
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

function openIntegrationsSettings() {
  uiStore.isEditorSettingsOpen = true;
  // TODO: Add logic to switch to Integrations tab in settings if possible
}


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
    <Splitpanes class="editor-splitpanes">
      <!-- Left Sidebar: Computer | BloggerDog -->
      <Pane :size="25" min-size="10" class="border-r border-ui-border bg-ui-bg-elevated flex flex-col min-w-0 overflow-hidden">
        <div class="flex items-center gap-1 p-2 border-b border-ui-border bg-ui-bg-accent/10">
          <UButton
            :color="fileManagerStore.filesPageActiveTab === 'computer' ? 'primary' : 'neutral'"
            :variant="fileManagerStore.filesPageActiveTab === 'computer' ? 'soft' : 'ghost'"
            size="xs"
            class="flex-1 justify-center truncate"
            @click="fileManagerStore.setFilesPageActiveTab('computer')"
          >
            {{ workspaceStore.workspaceProviderId === 'tauri' ? t('fastcat.fileManager.tabs.computer') : t('fastcat.fileManager.tabs.workspace') }}
          </UButton>
          <UButton
            :color="fileManagerStore.filesPageActiveTab === 'bloggerdog' ? 'primary' : 'neutral'"
            :variant="fileManagerStore.filesPageActiveTab === 'bloggerdog' ? 'soft' : 'ghost'"
            size="xs"
            class="flex-1 justify-center truncate"
            @click="fileManagerStore.setFilesPageActiveTab('bloggerdog')"
          >
            Bloggerdog
          </UButton>
        </div>

        <div class="flex-1 min-h-0">
          <template v-if="fileManagerStore.filesPageActiveTab === 'computer'">
            <ComputerFileManager />
          </template>
          <template v-else>
            <div v-if="!bloggerDogVfs" class="h-full flex flex-col items-center justify-center p-6 text-center gap-4">
              <div class="p-4 rounded-full bg-ui-bg-accent/20">
                <UIcon name="i-heroicons-cloud-slash" class="w-12 h-12 text-ui-text-dim opacity-50" />
              </div>
              <div class="space-y-1">
                <h3 class="font-medium text-ui-text">
                  {{ t('fastcat.fileManager.remote.not_configured_title', 'BloggerDog not configured') }}
                </h3>
                <p class="text-sm text-ui-text-dim">
                  {{ t('fastcat.fileManager.remote.not_configured_desc', 'Integrate with BloggerDog to manage your remote content.') }}
                </p>
              </div>
              <UButton 
                color="primary" 
                size="sm" 
                icon="i-heroicons-cog-6-tooth"
                @click="openIntegrationsSettings"
              >
                {{ t('fastcat.fileManager.remote.configure_action', 'Configure Integration') }}
              </UButton>
            </div>
            <FileBrowser 
              v-else
              :remote-mode-only="true" 
              :vfs="bloggerDogVfs"
              class="h-full" 
            />
          </template>
        </div>
      </Pane>

      <!-- Main Project Panels -->
      <Pane :size="75">
        <Splitpanes
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
  </div>

</template>
