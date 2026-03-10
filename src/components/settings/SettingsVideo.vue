<script setup lang="ts">
import { useWorkspaceStore } from '~/stores/workspace.store';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();

const isWebGLSupported = ref(false);
const isWebGPUSupported = ref(false);
const isWebCodecsSupported = ref(false);

onMounted(async () => {
  // Check WebGL
  const canvas = document.createElement('canvas');
  isWebGLSupported.value = !!(
    canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
  );

  // Check WebGPU
  if (navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      isWebGPUSupported.value = !!adapter;
    } catch {
      isWebGPUSupported.value = false;
    }
  }

  // Check WebCodecs
  isWebCodecsSupported.value = typeof window.VideoEncoder !== 'undefined';
});

function resetDefaults() {
  workspaceStore.userSettings.video = { ...DEFAULT_USER_SETTINGS.video };
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-between gap-3">
      <div class="text-sm font-medium text-ui-text">
        {{ t('videoEditor.settings.video.performance', 'Performance') }}
      </div>
      <UButton size="xs" color="neutral" variant="ghost" @click="resetDefaults">
        {{ t('videoEditor.settings.resetDefaults', 'Reset to defaults') }}
      </UButton>
    </div>

    <!-- GPU Support Info -->
    <div class="flex flex-col gap-3">
      <div class="text-sm font-medium text-ui-text-muted">
        {{ t('videoEditor.settings.video.gpuSupport', 'GPU Support') }}
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div
          class="flex items-center justify-between p-3 rounded border border-ui-border-muted bg-ui-bg-muted/30"
        >
          <span class="text-sm">{{ t('videoEditor.settings.video.webgl', 'WebGL') }}</span>
          <UIcon
            :name="isWebGLSupported ? 'i-lucide-check-circle-2' : 'i-lucide-x-circle'"
            :class="isWebGLSupported ? 'text-green-500' : 'text-red-500'"
            class="w-5 h-5"
          />
        </div>
        <div
          class="flex items-center justify-between p-3 rounded border border-ui-border-muted bg-ui-bg-muted/30"
        >
          <span class="text-sm">{{ t('videoEditor.settings.video.webgpu', 'WebGPU') }}</span>
          <UIcon
            :name="isWebGPUSupported ? 'i-lucide-check-circle-2' : 'i-lucide-x-circle'"
            :class="isWebGPUSupported ? 'text-green-500' : 'text-red-500'"
            class="w-5 h-5"
          />
        </div>
        <div
          class="flex items-center justify-between p-3 rounded border border-ui-border-muted bg-ui-bg-muted/30"
        >
          <span class="text-sm">{{ t('videoEditor.settings.video.webcodecs', 'WebCodecs') }}</span>
          <UIcon
            :name="isWebCodecsSupported ? 'i-lucide-check-circle-2' : 'i-lucide-x-circle'"
            :class="isWebCodecsSupported ? 'text-green-500' : 'text-red-500'"
            class="w-5 h-5"
          />
        </div>
      </div>
    </div>

    <!-- Settings -->
    <div class="flex flex-col gap-4">
      <label class="flex items-start gap-3 cursor-pointer group">
        <UCheckbox v-model="workspaceStore.userSettings.video.enableFfmpeg" class="mt-0.5" />
        <div class="flex flex-col gap-0.5">
          <span class="text-sm text-ui-text group-hover:text-ui-text-highlight transition-colors">
            {{ t('videoEditor.settings.video.enableFfmpeg', 'Use FFmpeg') }}
          </span>
          <span class="text-xs text-ui-text-muted">
            {{
              t(
                'videoEditor.settings.video.enableFfmpegHelp',
                'Enables FFmpeg for certain video processing operations',
              )
            }}
          </span>
        </div>
      </label>
    </div>

    <div class="text-xs text-ui-text-muted">
      {{ t('videoEditor.settings.userSavedNote', 'Saved to .gran/user.settings.json') }}
    </div>
  </div>
</template>
