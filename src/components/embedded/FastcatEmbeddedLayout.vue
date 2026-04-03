<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch, getCurrentInstance, provide } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import MobileMonitorContainer from '~/components/monitor/MobileMonitorContainer.vue';
import MobileTimeline from '~/components/timeline/MobileTimeline.vue';
import ExportForm from '~/components/export/ExportForm.vue';
import UiMobileDrawer from '~/components/ui/UiMobileDrawer.vue';
import { loadExternalAssets, type ExternalAsset } from '~/utils/external-assets.service';
import { useMediaStore } from '~/stores/media.store';

const props = defineProps<{
  assets?: ExternalAsset[];
  workspaceId?: string;
  locale?: string;
}>();

const { t, locale } = useI18n();
const workspaceStore = useWorkspaceStore();
const projectStore = useProjectStore();
const timelineStore = useTimelineStore();
const mediaStore = useMediaStore();

const emit = defineEmits<{
  (e: 'exported', data: any): void;
}>();

const isExportDrawerOpen = ref(false);
const isReady = ref(false);
const teleportTarget = ref<HTMLElement | null>(null);
const internalWorkspaceId = ref('');

provide('teleportTarget', teleportTarget);

watch(() => props.locale, (newLocale) => {
  if (newLocale) locale.value = newLocale;
}, { immediate: true });

/**
 * Initializes the workspace and project for embedded use.
 */
async function initEmbedded() {
  workspaceStore.isEphemeral = true;

  if (!workspaceStore.workspaceHandle) {
    internalWorkspaceId.value = props.workspaceId || `embedded-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    await workspaceStore.initAutomaticWorkspace(internalWorkspaceId.value);
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

  // Wait for the project to be fully initialized
  let retries = 0;
  while (projectStore.currentProjectName !== 'embedded_project' && retries < 100) {
    await new Promise(resolve => setTimeout(resolve, 50));
    retries++;
  }

  // Load external assets if provided
  if (props.assets && props.assets.length > 0) {
    const results = await loadExternalAssets({
      assets: props.assets,
      getProjectFileHandle: (path, options) => projectStore.getProjectFileHandleByRelativePath({ relativePath: path, ...options })
    });
    
    // 3. Prepare timeline (Ensure we have default tracks instead of blindly adding new ones)
    if (!timelineStore.timelineDoc || timelineStore.timelineDoc.tracks.length === 0) {
      timelineStore.ensureTimelineDoc();
    }

    // Auto-add assets to timeline if empty
    const itemsCount = timelineStore.timelineDoc?.tracks.reduce((acc, t) => acc + t.items.length, 0) || 0;
    
    if (itemsCount === 0) {
      const trackOffsetsUs: Record<string, number> = {};
      
      const hasVideos = results.some(res => res.success && res.asset.type === 'video');
      const hasImages = results.some(res => res.success && res.asset.type === 'image');

      for (const res of results) {
        if (!res.success) continue;
        
        const assetType = res.asset.type;
        let targetTrackId = '';
        
        if (assetType === 'audio') {
          targetTrackId = 'a1';
        } else if (assetType === 'video') {
          targetTrackId = 'v1';
        } else if (assetType === 'image') {
          targetTrackId = (hasVideos && hasImages) ? 'v2' : 'v1';
        } else {
          targetTrackId = 'v1';
        }
        
        // Ensure track exists, fallback to first of kind if target not found
        const tracks = timelineStore.timelineDoc?.tracks || [];
        let track = tracks.find(t => t.id === targetTrackId);
        if (!track) {
          const kind = assetType === 'audio' ? 'audio' : 'video';
          track = tracks.find(t => t.kind === kind);
        }
        
        if (!track) continue;
        
        const trackId = track.id;
        
        // Fetch metadata to know duration
        const metadata = await mediaStore.getOrFetchMetadataByPath(res.path);
        const durationUs = metadata?.durationUs || 3000000; // Default to 3s for images
        
        const startUs = trackOffsetsUs[trackId] || 0;

        // Add to timeline
        await timelineStore.addClipToTimelineFromPath({
          trackId,
          name: res.asset.filename || 'Clip',
          path: res.path,
          startUs,
          pseudo: true
        });
        
        // Update offset for this track
        trackOffsetsUs[trackId] = startUs + durationUs;
      }
    }
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
  
  // Try to remove the isolated folder itself if we created one
  if (internalWorkspaceId.value && navigator.storage?.getDirectory) {
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(internalWorkspaceId.value, { recursive: true });
    } catch (e) {
      // Ignore if not found or busy
    }
  }
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
  <div v-if="isReady" class="flex flex-col h-full bg-zinc-950 text-white overflow-hidden selection:bg-primary/30 relative">
    <!-- Teleport Target for internal components (stays inside Shadow DOM) -->
    <div ref="teleportTarget" class="absolute inset-0 pointer-events-none z-[1000]"></div>

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
