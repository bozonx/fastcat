<script setup lang="ts">
import { useRoute } from 'vue-router'

const route = useRoute()

const navItems = [
  { path: '/m', icon: 'lucide:home', label: 'Projects', exact: true },
  { path: '/m/files', icon: 'lucide:file-video', label: 'Files' },
  { path: '/m/edit', icon: 'lucide:film', label: 'Edit' },
  { path: '/m/sound', icon: 'lucide:music', label: 'Sound' },
  { path: '/m/export', icon: 'lucide:download', label: 'Export' },
]

const isActive = (itemPath: string, exact?: boolean) => {
  if (exact) {
    return route.path === itemPath
  }
  return route.path.startsWith(itemPath)
}
</script>

<template>
  <div class="flex h-screen w-full flex-col bg-slate-950 text-slate-200">
    <!-- Main Content Area -->
    <main class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden relative">
      <slot />
    </main>

    <!-- Bottom Navigation Bar -->
    <nav class="shrink-0 border-t border-slate-800 bg-slate-900 pb-safe">
      <div class="flex h-16 items-center justify-around px-2">
        <NuxtLink
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="flex flex-col items-center justify-center w-16 h-full gap-1 transition-colors"
          :class="isActive(item.path, item.exact) ? 'text-blue-500' : 'text-slate-400 hover:text-slate-300'"
        >
          <Icon :name="item.icon" class="w-6 h-6" />
          <span class="text-[10px] font-medium">{{ item.label }}</span>
        </NuxtLink>
      </div>
    </nav>
  </div>
</template>

<style scoped>
/* Support for iOS safe area padding at the bottom */
.pb-safe {
  padding-bottom: env(safe-area-inset-bottom, 0);
}
</style>
