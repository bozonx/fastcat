<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch, getCurrentInstance } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import MobileMonitorContainer from '~/components/monitor/MobileMonitorContainer.vue';
import MobileTimeline from '~/components/timeline/MobileTimeline.vue';
import ExportForm from '~/components/export/ExportForm.vue';
import UiMobileDrawer from '~/components/ui/UiMobileDrawer.vue';
import { loadExternalAssets, type ExternalAsset } from '~/utils/external-assets.service';

const props = defineProps<{
  assets?: ExternalAsset[];
}>();

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const projectStore = useProjectStore();
const timelineStore = useTimelineStore();

const emit = defineEmits<{
  (e: 'exported', data: any): void;
}>();

const isExportDrawerOpen = ref(false);
const isReady = ref(false);

/**
 * Initializes the workspace and project for embedded use.
 */
async function initEmbedded() {
  workspaceStore.isEphemeral = true;

  if (!workspaceStore.workspaceHandle) {
    await workspaceStore.initAutomaticWorkspace();
  }

  // Create or open a default project for the embedded session
  if (workspaceStore.workspaceHandle && !projectStore.currentProjectName) {
    const defaultProjectName = 'embedded_project';
    
    // Check if project already exists, otherwise create it
    if (!workspaceStore.projects.includes(defaultProjectName)) {
      await projectStore.createProject(defaultProjectName);
    } else {
      await projectStore.openProject(defaultProjectName);
    }
  }

  // Load external assets if provided
  if (props.assets && props.assets.length > 0) {
    const results = await loadExternalAssets({
      assets: props.assets,
      getProjectFileHandle: (path, options) => projectStore.getProjectFileHandleByRelativePath({ relativePath: path, ...options })
    });
    
    // Auto-add assets to timeline if it's empty
    const isTimelineEmpty = (timelineStore.timelineDoc?.tracks.reduce((acc, t) => acc + t.items.length, 0) || 0) === 0;
    
    if (isTimelineEmpty) {
      let currentOffsetUs = 0;
      
      for (const res of results) {
        if (!res.success) continue;
        
        // Resolve kind for the track selection
        const kind = res.asset.type === 'video' || res.asset.type === 'image' ? 'video' : 'audio';
        const trackId = timelineStore.resolveMobileTargetTrackId(kind);
        
        // Add to timeline
        await timelineStore.addClipToTimelineFromPath({
          trackId,
          name: res.asset.filename || 'Clip',
          path: res.path,
          startUs: currentOffsetUs,
          pseudo: true // Automatically handle gaps and overlaps
        });
        
        currentOffsetUs += 5000000; // 5 seconds offset for next clip
      }
    }
  }
  
  // Wait for timeline to be loaded
  let retries = 0;
  while (!timelineStore.timelineDoc && retries < 100) {
    await new Promise(resolve => setTimeout(resolve, 50));
    retries++;
  }
  
  if (!timelineStore.timelineDoc) {
    console.warn('[Embedded] Timeline failed to load within timeout');
  }
  
  isReady.value = true;
}

onMounted(async () => {
  await initEmbedded();
});

onUnmounted(async () => {
  // Wipe workspace only if it was an automatic one (opfs-based)
  // For now, we assume this layout is only used in automatic mode
  await workspaceStore.wipeWorkspace();
});

function handleExported(data: any) {
  isExportDrawerOpen.value = false;
  
  // Emit event for both Vue component and custom element consumers
  emit('exported', data);
  
  // Extra: Dispatch a standard DOM event for non-Vue hosts
  const host = getCurrentInstance()?.vnode.el?.parentElement;
  if (host) {
    host.dispatchEvent(new CustomEvent('fastcat:exported', { 
      detail: data,
      bubbles: true,
      composed: true
    }));
  }
}
</script>

<template>
  <div v-if="isReady" class="flex flex-col h-full bg-zinc-950 text-white overflow-hidden selection:bg-primary/30">
    <!-- Simple Header -->
    <header class="h-12 shrink-0 border-b border-zinc-800 flex items-center justify-between px-4 bg-zinc-900/50 backdrop-blur-md z-10">
      <div class="flex items-center gap-2">
        <div class="w-2 h-2 rounded-full bg-primary animate-pulse" />
        <span class="text-sm font-medium tracking-wide uppercase opacity-80">Fastcat Editor</span>
      </div>
      
      <button 
        class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary hover:bg-primary-hover text-white text-sm font-semibold transition-all active:scale-95 shadow-lg shadow-primary/20"
        @click="isExportDrawerOpen = true"
      >
        <UIcon name="i-heroicons-arrow-up-tray" class="w-4 h-4" />
        {{ t('videoEditor.export.title', 'Export') }}
      </button>
    </header>

    <!-- Main Content Area -->
    <main class="flex-1 min-h-0 flex flex-col">
      <!-- Monitor at the top -->
      <section class="flex-[0.4] min-h-[240px] bg-black">
        <MobileMonitorContainer flexible />
      </section>

      <!-- Timeline at the bottom -->
      <section class="flex-[0.6] min-h-0 border-t border-zinc-800">
        <MobileTimeline />
      </section>
    </main>

    <!-- Export Drawer -->
    <UiMobileDrawer
      v-model:open="isExportDrawerOpen"
      :title="t('videoEditor.export.title', 'Export')"
      :snap-points="[0.9]"
      direction="bottom"
    >
      <div class="h-full">
        <ExportForm @exported="handleExported" />
      </div>
    </UiMobileDrawer>

    <!-- Loading Overlay -->
    <div v-if="workspaceStore.isLoading" class="absolute inset-0 bg-black/60 backdrop-blur-sm z-50 flex flex-col items-center justify-center gap-4">
      <div class="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      <span class="text-sm font-medium animate-pulse">{{ t('common.loading', 'Loading...') }}</span>
    </div>
  </div>
  
  <div v-else class="flex items-center justify-center h-full bg-black">
     <div class="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
  </div>
</template>

<style scoped>
/* Ensure the layout takes full height and ignores parent positioning */
:host {
  display: block;
  height: 100%;
}
</style>
