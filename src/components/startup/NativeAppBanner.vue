<script setup lang="ts">
import { ref } from 'vue';
import { isTauriRuntime } from '~/utils/runtime';

const isNative = isTauriRuntime();
const isDismissed = ref(false);

function dismiss() {
  isDismissed.value = true;
  try {
    sessionStorage.setItem('fastcat_native_banner_dismissed', 'true');
  } catch {
    // Ignore
  }
}

// Check session storage on mount
if (typeof window !== 'undefined') {
  try {
    if (sessionStorage.getItem('fastcat_native_banner_dismissed') === 'true') {
      isDismissed.value = true;
    }
  } catch {
    // Ignore
  }
}
</script>

<template>
  <div
    v-if="!isNative && !isDismissed"
    class="relative w-full bg-gradient-to-r from-slate-900 via-blue-950/60 to-slate-900 border border-blue-500/30 rounded-2xl p-4 md:p-5 shadow-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-slate-100"
  >
    <div class="flex items-start gap-3">
      <div class="p-2.5 bg-blue-500/10 border border-blue-500/30 rounded-xl text-blue-400 shrink-0">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
          <line x1="8" y1="21" x2="16" y2="21"/>
          <line x1="12" y1="17" x2="12" y2="21"/>
        </svg>
      </div>
      <div>
        <h4 class="text-sm font-semibold text-slate-100">
          Нужна максимальная скорость для 4K-проектов?
        </h4>
        <p class="text-xs text-slate-300 mt-0.5 max-w-2xl">
          Для более тяжелых проектов с множеством слоёв и эффектов рекомендуется скачать нативное настольное приложение FastCat.
        </p>
      </div>
    </div>

    <div class="flex items-center gap-2 self-end sm:self-center shrink-0">
      <a
        href="https://fastcat.app/download"
        target="_blank"
        rel="noopener noreferrer"
        class="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs rounded-xl transition-colors inline-flex items-center gap-1.5 shadow-sm"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Скачать приложение
      </a>

      <button
        type="button"
        class="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 rounded-xl transition-colors"
        title="Скрыть уведомление"
        @click="dismiss"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  </div>
</template>
