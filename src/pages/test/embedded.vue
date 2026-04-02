<script setup lang="ts">
import { onMounted } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import FastcatEmbeddedLayout from '~/components/embedded/FastcatEmbeddedLayout.vue';

definePageMeta({
  layout: 'empty',
});

const workspaceStore = useWorkspaceStore();

onMounted(async () => {
  // Ensure we are in a clean state for testing
  await workspaceStore.resetWorkspace();
});
</script>

<template>
  <div class="fixed inset-0 w-screen h-screen overflow-hidden bg-black flex flex-col items-stretch justify-items-stretch">
    <!-- Fastcat Embedded Editor Root -->
    <client-only>
      <FastcatEmbeddedLayout />
    </client-only>

    <!-- Debug info overlay (optional, can be hidden) -->
    <div 
      v-if="workspaceStore.error" 
      class="fixed top-4 left-4 right-4 p-4 rounded-xl bg-red-950 border border-red-500/30 text-red-200 z-100 shadow-2xl backdrop-blur-md animate-in slide-in-from-top duration-300"
    >
      <div class="flex items-center gap-3">
        <UIcon name="i-heroicons-exclamation-triangle" class="w-6 h-6 text-red-400" />
        <div class="flex flex-col">
          <span class="font-bold text-sm tracking-wide uppercase opacity-70">Error Initializing Editor</span>
          <p class="text-sm opacity-90">{{ workspaceStore.error }}</p>
        </div>
      </div>
      <button 
        class="mt-4 w-full py-2 bg-red-500 hover:bg-red-400 text-white rounded-lg font-semibold transition-all active:scale-[0.98]"
        @click="workspaceStore.initAutomaticWorkspace()"
      >
        Retry Initialization
      </button>
    </div>
  </div>
</template>

<style>
/* Reset some default Nuxt/Tailwind layout issues for full-screen web apps */
html, body, #__nuxt {
  height: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
  background: black;
}

/* Custom transitions for the editor load */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.5s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
