<script setup lang="ts">
import { onMounted, markRaw } from 'vue';
import { useProjectTabs, registerProjectTab } from '~/composables/project/useProjectTabs';
import ProjectFiles from '~/components/project/ProjectFiles.vue';
import ProjectHistory from '~/components/project/ProjectHistory.vue';
import ProjectEffects from '~/components/project/ProjectEffects.vue';
import TimelineToolbar from '~/components/timeline/TimelineToolbar.vue';

const { tabs, activeTabId, setActiveTab, initDefaultTab } = useProjectTabs();

onMounted(() => {
  registerProjectTab({
    id: 'files',
    label: 'Files',
    icon: 'i-heroicons-folder',
    component: markRaw(ProjectFiles),
  });

  registerProjectTab({
    id: 'history',
    label: 'History',
    icon: 'i-heroicons-clock',
    component: markRaw(ProjectHistory),
  });

  registerProjectTab({
    id: 'effects',
    label: 'Effects',
    icon: 'i-heroicons-sparkles',
    component: markRaw(ProjectEffects),
  });

  initDefaultTab();
});
</script>

<template>
  <div class="flex flex-col h-full bg-ui-bg-elevated border-r border-ui-border min-w-0 overflow-hidden">
    <div
      class="flex items-center gap-4 px-3 py-2 border-b border-ui-border shrink-0 select-none"
    >
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="text-xs font-semibold uppercase tracking-wider transition-colors outline-none"
        :class="
          activeTabId === tab.id
            ? 'text-primary-400'
            : 'text-ui-text-muted hover:text-ui-text'
        "
        @click="setActiveTab(tab.id)"
      >
        {{ tab.label }}
      </button>
    </div>

    <div class="flex flex-col flex-1 min-h-0 overflow-hidden">
      <component
        :is="tabs.find((t) => t.id === activeTabId)?.component"
        v-if="activeTabId"
      />
    </div>

    <TimelineToolbar />
  </div>
</template>
