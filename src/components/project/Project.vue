<script setup lang="ts">
import { markRaw, onMounted } from 'vue';
import ProjectFilesTab from '~/components/project/ProjectFilesTab.vue';
import ProjectHistory from '~/components/project/ProjectHistory.vue';
import ProjectEffects from '~/components/project/ProjectEffects.vue';
import ProjectLibrary from '~/components/project/ProjectLibrary.vue';
import ProjectTabBar from '~/components/project/ProjectTabBar.vue';
import ProjectMarkers from '~/components/project/ProjectMarkers.vue';
import ProjectTabFileViewer from '~/components/project/ProjectTabFileViewer.vue';
import { useProjectTabs } from '~/composables/project/useProjectTabs';
import { useFocusStore } from '~/stores/focus.store';
import { useProjectTabsStore } from '~/stores/project-tabs.store';

const { t } = useI18n();
const focusStore = useFocusStore();

const props = withDefaults(
  defineProps<{
    useExternalFocus?: boolean;
    compact?: boolean;
  }>(),
  {
    useExternalFocus: false,
    compact: false,
  },
);

const emit = defineEmits<{
  (e: 'tab-drag-start', event: DragEvent, tabId: string): void;
}>();

const tabsStore = useProjectTabsStore();
const { initDefaultTab, registerProjectTab } = tabsStore;
const { activateProjectFocus, activeFileTab, activeStaticComponent } = useProjectTabs({
  enableUiEffects: false,
});

onMounted(() => {
  registerProjectTab({
    id: 'files',
    label: t('videoEditor.fileManager.tabs.files'),
    icon: 'i-heroicons-folder',
    component: markRaw(ProjectFilesTab),
  });

  registerProjectTab({
    id: 'history',
    label: t('videoEditor.fileManager.tabs.history'),
    icon: 'i-heroicons-clock',
    component: markRaw(ProjectHistory),
  });

  registerProjectTab({
    id: 'effects',
    label: t('videoEditor.fileManager.tabs.effects'),
    icon: 'i-heroicons-sparkles',
    component: markRaw(ProjectEffects),
  });

  registerProjectTab({
    id: 'library',
    label: t('videoEditor.fileManager.tabs.library'),
    icon: 'i-heroicons-rectangle-group',
    component: markRaw(ProjectLibrary),
  });

  registerProjectTab({
    id: 'markers',
    label: t('videoEditor.fileManager.tabs.markers'),
    icon: 'i-heroicons-tag',
    component: markRaw(ProjectMarkers),
  });

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
    <ProjectTabBar @tab-drag-start="(event, tabId) => emit('tab-drag-start', event, tabId)" />

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
