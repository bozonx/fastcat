<script setup lang="ts">
import { Pane, Splitpanes } from 'splitpanes';
import FileBrowser from '~/components/file-manager/FileBrowser.vue';
import FileManagerPanel from '~/components/file-manager/FileManagerPanel.vue';
import PropertiesPanel from '~/components/layout-panels/PropertiesPanel.vue';
import type { FsEntry } from '~/types/fs';
import type { SelectedEntity } from '~/stores/selection.store';

interface Props {
  sizes: number[];
  selectedEntity: SelectedEntity | null;
}

defineProps<Props>();

import { useFileManagerStore } from '~/stores/file-manager.store';

const emit = defineEmits<{
  (e: 'resized', event: { panes: Array<{ size: number }> }): void;
  (e: 'selectFolder', entry: FsEntry | null): void;
  (e: 'clearSelection'): void;
}>();

const { t } = useI18n();
const fileManagerStore = useFileManagerStore();

import { BloggerDogVfsAdapter } from '~/file-manager/core/vfs/bloggerdog.adapter';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { resolveExternalServiceConfig } from '~/utils/external-integrations';
import { computed, shallowRef, watch } from 'vue';

const workspaceStore = useWorkspaceStore();
const runtimeConfig = useRuntimeConfig();

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

// Auto-open panel when integration becomes available
watch(
  () => !!bloggerDogVfs.value,
  (available) => {
    if (available && !fileManagerStore.isBloggerDogPanelVisible) {
      fileManagerStore.isBloggerDogPanelVisible = true;
    }
  },
  { immediate: true }
);
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
              @select="(entry) => emit('selectFolder', entry)"
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
          @select="(entry) => emit('selectFolder', entry)"
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
