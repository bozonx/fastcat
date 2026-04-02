<script setup lang="ts">
import FastcatEmbeddedLayout from '~/components/embedded/FastcatEmbeddedLayout.vue';

definePageMeta({
  layout: 'embedded',
});


const workspaceStore = useWorkspaceStore();

const assets = [
  { url: 'https://www.w3schools.com/html/mov_bbb.mp4' },
  { url: 'https://raw.githubusercontent.com/mdn/webaudio-examples/master/audio-analyser/viper.mp3' },
  { url: 'https://picsum.photos/seed/fastcat/1280/720.jpg' }
];

function onExported(data: any) {
  console.log('[TestPage] Exported successfully:', data);
  const { file, filename } = data;
  
  // Create download link for testing
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

onMounted(async () => {
  // Ensure we are in a clean state for testing
  await workspaceStore.initAutomaticWorkspace();
});
</script>

<template>
  <div class="fixed inset-0 w-screen h-screen overflow-hidden bg-black flex flex-col items-stretch justify-items-stretch">
    <!-- Fastcat Embedded Editor Root -->
    <client-only>
      <FastcatEmbeddedLayout :assets="assets" @exported="onExported" />
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
