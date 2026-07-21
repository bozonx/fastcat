<script setup lang="ts">
import { ref } from 'vue';
import { useGpuCapability } from '~/composables/useGpuCapability';

const { shouldShowModal, browserInfo, dismissModal } = useGpuCapability();

const copied = ref(false);

async function copyFlagUrl() {
  if (!browserInfo.value.flagUrl) return;
  try {
    await navigator.clipboard.writeText(browserInfo.value.flagUrl);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2500);
  } catch {
    // Fallback if clipboard API is restricted
    const input = document.createElement('input');
    input.value = browserInfo.value.flagUrl;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2500);
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="shouldShowModal"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="webgpu-modal-title"
      >
        <div
          class="relative w-full max-w-xl bg-slate-900 border border-amber-500/40 rounded-2xl shadow-2xl p-6 md:p-8 text-slate-100 space-y-6 my-auto"
        >
          <!-- Header -->
          <div class="flex items-start gap-4">
            <div class="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400 shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </div>
            <div>
              <h2 id="webgpu-modal-title" class="text-xl font-bold text-slate-50">
                WebGPU недоступен (WebGL fallback)
              </h2>
              <p class="text-sm text-slate-400 mt-1">
                Ваш браузер работает в режиме WebGL. Некоторые визуальные эффекты рендеринга и переходы могут иметь ограниченную производительность или не поддерживаться.
              </p>
            </div>
          </div>

          <!-- Browser Flag Instruction Box -->
          <div class="bg-slate-800/80 border border-slate-700/80 rounded-xl p-4 space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-xs font-semibold uppercase tracking-wider text-amber-400">
                Включение WebGPU в {{ browserInfo.browserDisplayName }}
              </span>
            </div>
            <p class="text-xs text-slate-300 leading-relaxed">
              {{ browserInfo.instructions }}
            </p>

            <div v-if="browserInfo.flagUrl" class="flex items-center gap-2 mt-2">
              <input
                type="text"
                readonly
                :value="browserInfo.flagUrl"
                class="flex-1 bg-slate-950 border border-slate-700 text-xs font-mono text-amber-300 px-3 py-2 rounded-lg select-all focus:outline-none focus:border-amber-500/50"
              />
              <button
                type="button"
                class="px-3 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-medium text-xs rounded-lg transition-colors shrink-0 flex items-center gap-1.5"
                @click="copyFlagUrl"
              >
                <svg v-if="!copied" xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                <svg v-else xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                {{ copied ? 'Скопировано!' : 'Скопировать ссылку' }}
              </button>
            </div>
          </div>

          <!-- Native App Recommendation -->
          <div class="bg-gradient-to-r from-blue-950/40 to-slate-800/40 border border-blue-500/20 rounded-xl p-4 space-y-3">
            <div class="flex items-center gap-2 text-blue-400">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                <line x1="8" y1="21" x2="16" y2="21"/>
                <line x1="12" y1="17" x2="12" y2="21"/>
              </svg>
              <h3 class="text-sm font-semibold text-slate-200">
                Нативное приложение FastCat
              </h3>
            </div>
            <p class="text-xs text-slate-300">
              Для обработки тяжелых 4K-видео и полного аппаратно-ускоренного рендеринга используйте установленную версию FastCat.
            </p>
            <div class="flex flex-wrap gap-2 pt-1">
              <a
                href="https://fastcat.app/download"
                target="_blank"
                rel="noopener noreferrer"
                class="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs rounded-lg transition-colors inline-flex items-center gap-1.5"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Скачать для Desktop
              </a>
            </div>
          </div>

          <!-- Dismiss Footer Action -->
          <div class="pt-2 flex justify-end">
            <button
              type="button"
              class="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition-colors border border-slate-700"
              @click="dismissModal"
            >
              Всё равно продолжить в WebGL-режиме
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
