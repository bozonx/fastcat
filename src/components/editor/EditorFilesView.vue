<script setup lang="ts">
import { ref, computed, shallowRef, watch, provide, onMounted } from 'vue';
import { Pane, Splitpanes } from 'splitpanes';
import FileBrowser from '~/components/file-manager/FileBrowser.vue';
import FileManagerPanel from '~/components/file-manager/FileManagerPanel.vue';
import ComputerFileManager from '~/components/file-manager/ComputerFileManager.vue';
import PropertiesPanel from '~/components/layout-panels/PropertiesPanel.vue';
import {
  useFilesPageFileManagerStore,
  useComputerSidebarStore,
  useBloggerDogSidebarStore,
} from '~/stores/file-manager.store';
import FileManagerStoreProvider from '~/components/file-manager/FileManagerStoreProvider.vue';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useUiStore } from '~/stores/ui.store';
import { useFocusStore, type PanelFocusId } from '~/stores/focus.store';
import { resolveExternalServiceConfig } from '~/utils/external-integrations';
import type { FsEntry } from '~/types/fs';
import type { SelectedEntity } from '~/stores/selection.store';

interface Props {
  sizes: number[];
  selectedEntity: SelectedEntity | null;
}

const props = defineProps<Props>();

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
const mainStore = useFilesPageFileManagerStore();
const computerSidebarStore = useComputerSidebarStore();
const bloggerDogSidebarStore = useBloggerDogSidebarStore();
const focusStore = useFocusStore();

const activeSidebarStore = computed(() =>
  workspaceStore.workspaceState.fileBrowser.activeTab === 'computer'
    ? computerSidebarStore
    : bloggerDogSidebarStore,
);

function setFilesPageActiveTab(tab: 'computer' | 'bloggerdog' | 'fastcat') {
  workspaceStore.batchUpdateWorkspaceState((draft) => {
    draft.fileBrowser.activeTab = tab;
  });
}

provide('fileManagerStore', mainStore);

const nuxtApp = useNuxtApp();
const isBloggerDogConfigured = computed(() => {
  const bloggerDogApiUrl =
    typeof runtimeConfig.public.bloggerDogApiUrl === 'string'
      ? runtimeConfig.public.bloggerDogApiUrl
      : '';

  return !!resolveExternalServiceConfig({
    service: 'files',
    integrations: workspaceStore.userSettings.integrations,
    bloggerDogApiUrl,
    fastcatAccountApiUrl: runtimeConfig.public.fastcatAccountApiUrl as string,
  });
});

const bloggerDogVfs = computed(() => {
  if (!isBloggerDogConfigured.value) return null;
  return (nuxtApp as any).$vfs;
});

function openIntegrationsSettings() {
  uiStore.showIntegrationSettings();
}

onMounted(() => {
  if (!mainStore.selectedFolder && !uiStore.selectedFsEntry) {
    mainStore.openFolder({
      name: projectStore.currentProjectName || 'Project',
      path: '',
      kind: 'directory',
    });
  }
});

const browserTotalSize = computed(() => (props.sizes?.[0] ?? 0) + (props.sizes?.[1] ?? 0));
const treeRelSize = computed(() => {
  const total = browserTotalSize.value;
  if (total === 0) return 30;
  return ((props.sizes?.[0] ?? 0) / total) * 100;
});
const listRelSize = computed(() => {
  const total = browserTotalSize.value;
  if (total === 0) return 70;
  return ((props.sizes?.[1] ?? 0) / total) * 100;
});

const normalizedSelectedEntity = computed(() => {
  const entity = props.selectedEntity;
  if (!entity || entity.source !== 'fileManager') return entity;

  const instanceId = (entity as any).instanceId;
  if (instanceId !== 'sidebar') return entity;

  if ((entity as any).entry?.source === 'remote') {
    return {
      ...entity,
      isExternal: true,
      origin: 'remote-browser' as const,
    };
  }

  if (workspaceStore.workspaceState.fileBrowser.activeTab === 'computer') {
    return {
      ...entity,
      isExternal: true,
      origin: 'workspace-browser' as const,
    };
  }

  return entity;
});

function onOuterResized(_event: { panes: Array<{ size: number }> }) {
  // Sidebar size is currently not persisted for this view
}

function onMainResized(event: { panes: Array<{ size: number }> }) {
  const browserSize = event.panes[0]?.size ?? 0;
  const propertiesSize = event.panes[1]?.size ?? 0;

  const currentBrowserTotalRaw = (props.sizes?.[0] ?? 0) + (props.sizes?.[1] ?? 0);
  const treeRatio =
    currentBrowserTotalRaw === 0 ? 0.3 : (props.sizes?.[0] ?? 0) / currentBrowserTotalRaw;
  const listRatio = 1 - treeRatio;

  const newSizes = [browserSize * treeRatio, browserSize * listRatio, propertiesSize];

  emit('resized', { panes: newSizes.map((s) => ({ size: s ?? 0 })) });
}

function onBrowserResized(event: { panes: Array<{ size: number }> }) {
  const treeRel = event.panes[0]?.size ?? 0;
  const listRel = event.panes[1]?.size ?? 0;

  const browserTotal = browserTotalSize.value;
  const newSizes = [
    (treeRel / 100) * browserTotal,
    (listRel / 100) * browserTotal,
    props.sizes?.[2] ?? 0,
  ];

  emit('resized', {
    panes: newSizes.map((s) => ({ size: Number(s ?? 0) })),
  });
}
</script>

<template>
  <Splitpanes class="editor-splitpanes h-full w-full" @resized="onOuterResized">
    <!-- Left Sidebar: Computer | BloggerDog -->
    <Pane
      :size="25"
      min-size="10"
      class="border-r border-ui-border flex flex-col min-w-0 overflow-hidden"
    >
      <div
        class="flex-1 flex flex-col min-h-0 relative panel-focus-frame bg-ui-bg-elevated"
        :class="{
          'panel-focus-frame--active': focusStore.isPanelFocused('dynamic:file-manager:sidebar'),
        }"
        @pointerdown.capture="focusStore.setPanelFocus('dynamic:file-manager:sidebar')"
      >
        <div class="flex items-center gap-1 p-2 border-b border-ui-border bg-ui-bg-accent/10">
          <UButton
            :color="workspaceStore.workspaceState.fileBrowser.activeTab === 'computer' ? 'primary' : 'neutral'"
            :variant="workspaceStore.workspaceState.fileBrowser.activeTab === 'computer' ? 'soft' : 'ghost'"
            size="xs"
            class="flex-1 justify-center truncate"
            @click="setFilesPageActiveTab('computer')"
          >
            {{
              workspaceStore.workspaceProviderId === 'tauri'
                ? t('fastcat.fileManager.tabs.computer')
                : t('fastcat.fileManager.tabs.workspace')
            }}
          </UButton>
          <UButton
            :color="workspaceStore.workspaceState.fileBrowser.activeTab === 'bloggerdog' ? 'primary' : 'neutral'"
            :variant="workspaceStore.workspaceState.fileBrowser.activeTab === 'bloggerdog' ? 'soft' : 'ghost'"
            size="xs"
            class="flex-1 justify-center truncate"
            @click="setFilesPageActiveTab('bloggerdog')"
          >
            Bloggerdog
          </UButton>
        </div>

        <FileManagerStoreProvider :store="activeSidebarStore">
          <template v-if="workspaceStore.workspaceState.fileBrowser.activeTab === 'computer'">
            <ComputerFileManager instance-id="sidebar" hide-focus-frame />
          </template>
          <template v-else>
            <div
              v-if="!isBloggerDogConfigured"
              class="h-full flex flex-col items-center justify-center p-6 text-center gap-4"
            >
              <div class="p-4 rounded-full bg-ui-bg-accent/20">
                <UIcon
                  name="i-heroicons-cloud-slash"
                  class="w-12 h-12 text-ui-text-dim opacity-50"
                />
              </div>
              <div class="space-y-1">
                <h3 class="font-medium text-ui-text">
                  {{
                    t(
                      'fastcat.fileManager.remote.not_configured_title',
                      'BloggerDog not configured',
                    )
                  }}
                </h3>
                <p class="text-sm text-ui-text-dim">
                  {{
                    t(
                      'fastcat.fileManager.remote.not_configured_desc',
                      'Integrate with BloggerDog to manage your remote content.',
                    )
                  }}
                </p>
              </div>
              <UButton
                color="primary"
                size="sm"
                icon="i-heroicons-cog-6-tooth"
                @click="openIntegrationsSettings"
              >
                {{ t('fastcat.fileManager.remote.configure_action') }}
              </UButton>
            </div>
            <FileBrowser
              v-else
              :remote-mode-only="true"
              :vfs="bloggerDogVfs"
              instance-id="sidebar"
              hide-focus-frame
              class="h-full"
            />
          </template>
        </FileManagerStoreProvider>
      </div>
    </Pane>

    <!-- Main Project Panels -->
    <Pane :size="75">
      <Splitpanes class="editor-splitpanes h-full" @resized="onMainResized">
        <!-- File Manager (Tree + Browser) -->
        <Pane :size="(sizes?.[0] ?? 0) + (sizes?.[1] ?? 0)" min-size="20">
          <Splitpanes
            class="editor-splitpanes h-full w-full relative panel-focus-frame"
            :class="{
              'panel-focus-frame--active': focusStore.isPanelFocused('dynamic:file-manager:main'),
            }"
            @resized="onBrowserResized"
            @pointerdown.capture="focusStore.setPanelFocus('dynamic:file-manager:main')"
          >
            <Pane :size="treeRelSize" min-size="10">
              <FileManagerPanel
                folders-only
                is-files-page
                class="h-full"
                instance-id="main"
                hide-focus-frame
                @select="(entry) => mainStore.openFolder(entry)"
              />
            </Pane>
            <Pane :size="listRelSize" min-size="10">
              <FileBrowser class="h-full" instance-id="main" hide-focus-frame />
            </Pane>
          </Splitpanes>
        </Pane>

        <!-- Properties -->
        <Pane :size="sizes[2]" min-size="10">
          <PropertiesPanel
            :entity="normalizedSelectedEntity"
            focus-id="dynamic:properties:files-main"
            class="h-full"
            @clear-selection="emit('clearSelection')"
            @pointerdown.capture="focusStore.setPanelFocus('dynamic:properties:files-main')"
          />
        </Pane>
      </Splitpanes>
    </Pane>
  </Splitpanes>
</template>
