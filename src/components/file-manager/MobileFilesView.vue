<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import MobileAssetBrowser from './MobileAssetBrowser.vue';
import MobileFileBrowser from './MobileFileBrowser.vue';

type FilesTab = 'assets' | 'files';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();

const experimentalFeatures = computed(() => workspaceStore.userSettings.experimentalFeatures);

const activeTab = ref<FilesTab>('assets');

const tabs = computed<Array<{ id: FilesTab; labelKey: string; icon: string }>>(() => {
  const list = [{ id: 'assets' as FilesTab, labelKey: 'common.assets', icon: 'lucide:layers' }];
  if (experimentalFeatures.value) {
    list.push({ id: 'files', labelKey: 'common.files', icon: 'lucide:folder-open' });
  }
  return list;
});

watch(experimentalFeatures, (enabled) => {
  if (!enabled && activeTab.value === 'files') {
    activeTab.value = 'assets';
  }
});
</script>

<template>
  <div class="flex h-full w-full flex-col landscape:flex-row">
    <!-- Tab switcher: horizontal on top (portrait), vertical on the left (landscape) -->
    <div
      class="shrink-0 border-b border-ui-border bg-ui-bg/95 backdrop-blur landscape:border-b-0 landscape:border-r landscape:h-full landscape:w-24"
    >
      <div
        class="flex items-stretch gap-1 p-1.5 landscape:flex-col landscape:h-full landscape:py-4 landscape:gap-2"
      >
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="flex flex-1 flex-col items-center justify-center gap-1 rounded-xl px-3 py-2 text-center transition-colors outline-none landscape:flex-none landscape:py-3"
          :class="
            activeTab === tab.id
              ? 'bg-selection-accent-500/12 text-selection-accent-400'
              : 'text-ui-text-muted active:bg-ui-bg-elevated'
          "
          :aria-pressed="activeTab === tab.id"
          @click="activeTab = tab.id"
        >
          <Icon :name="tab.icon" class="w-5 h-5 shrink-0" />
          <span class="text-xs font-medium">{{ t(tab.labelKey) }}</span>
        </button>
      </div>
    </div>

    <!-- Active tab content -->
    <div class="relative min-h-0 min-w-0 flex-1">
      <MobileAssetBrowser v-if="activeTab === 'assets'" />
      <MobileFileBrowser v-else />
    </div>
  </div>
</template>
