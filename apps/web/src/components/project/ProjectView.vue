<script setup lang="ts">
import { markRaw, onMounted, provide } from 'vue';
import ProjectFilesTab from '~/components/project/ProjectFilesTab.vue';
import ProjectHistory from '~/components/project/ProjectHistory.vue';
import ProjectEffects from '~/components/project/ProjectEffects.vue';
import ProjectLibrary from '~/components/project/ProjectLibrary.vue';
import ProjectTabBar from '~/components/project/ProjectTabBar.vue';
import ProjectMarkers from '~/components/project/ProjectMarkers.vue';
import ProjectBackups from '~/components/project/ProjectBackups.vue';
import ProjectTabFileViewer from '~/components/project/ProjectTabFileViewer.vue';
import { useProjectTabs } from '~/composables/project/useProjectTabs';
import { useFocusStore } from '~/stores/focus.store';
import { useProjectTabsStore } from '~/stores/project-tabs.store';
import { useWorkspaceStore } from '~/stores/workspace.store';

const { t } = useI18n();
const focusStore = useFocusStore();
const workspaceStore = useWorkspaceStore();

const props = withDefaults(
  defineProps<{
    useExternalFocus?: boolean;
    compact?: boolean;
    fileManagerInstanceId?: string;
    /** The embed has no project filesystem or session-local backup surface. */
    embedded?: boolean;
  }>(),
  {
    useExternalFocus: false,
    compact: false,
    fileManagerInstanceId: 'fileManager',
    embedded: false,
  },
);

// Expose the owning dynamic-panel id to the Files tab so its file browser/tree
// register focus under the same panel id (see ProjectFilesTab). The panel is
// remounted (keyed by id) when it changes, so a plain value is sufficient.
provide('fileManagerPanelInstanceId', props.fileManagerInstanceId);

const tabsStore = useProjectTabsStore();
const { initDefaultTab, registerProjectTab } = tabsStore;
const { activateProjectFocus, activeFileTab, activeStaticComponent } = useProjectTabs({
  enableUiEffects: false,
});

onMounted(() => {
  if (!props.embedded) {
    registerProjectTab({
      id: 'files',
      label: t('videoEditor.fileManager.tabs.files'),
      icon: 'i-heroicons-folder',
      component: markRaw(ProjectFilesTab),
    });
  }

  if (workspaceStore.inDevelopmentFeaturesEnabled && !props.embedded) {
    registerProjectTab({
      id: 'history',
      label: t('videoEditor.fileManager.tabs.history'),
      icon: 'i-heroicons-clock',
      component: markRaw(ProjectHistory),
    });
  }

  registerProjectTab({
    id: 'effects',
    label: t('videoEditor.fileManager.tabs.effects'),
    icon: 'i-heroicons-sparkles',
    component: markRaw(ProjectEffects),
  });

  if (workspaceStore.inDevelopmentFeaturesEnabled && !props.embedded) {
    registerProjectTab({
      id: 'library',
      label: t('videoEditor.fileManager.tabs.library'),
      icon: 'i-heroicons-rectangle-group',
      component: markRaw(ProjectLibrary),
    });
  }

  registerProjectTab({
    id: 'markers',
    label: t('videoEditor.fileManager.tabs.markers'),
    icon: 'i-heroicons-tag',
    component: markRaw(ProjectMarkers),
  });

  if (workspaceStore.inDevelopmentFeaturesEnabled && !props.embedded) {
    registerProjectTab({
      id: 'backups',
      label: t('videoEditor.timeline.backups.tabLabel'),
      icon: 'i-heroicons-archive-box',
      component: markRaw(ProjectBackups),
    });
  }

  initDefaultTab();
});
</script>

<template>
  <div
    class="panel-focus-frame flex flex-col h-full bg-ui-bg-elevated border-r border-ui-border min-w-0 overflow-hidden"
    :class="{
      'panel-focus-frame--active': !props.useExternalFocus && focusStore.isPanelFocused('project'),
    }"
    @pointerdown.capture="!props.useExternalFocus && activateProjectFocus()"
  >
    <ProjectTabBar />

    <div
      class="flex flex-col flex-1 min-h-0 overflow-hidden"
      @pointerdown.capture="activateProjectFocus"
    >
      <ProjectTabFileViewer
        v-if="activeFileTab"
        :file-path="activeFileTab.filePath"
        :file-name="activeFileTab.fileName"
        :media-type="activeFileTab.mediaType"
      />

      <component :is="activeStaticComponent" v-else-if="activeStaticComponent" :compact="compact" />
    </div>
  </div>
</template>
