<script setup lang="ts">
import { ref, computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import MobileMediaPickerDrawer from './MobileMediaPickerDrawer.vue';

const props = defineProps<{ isOpen: boolean }>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'open-virtual-clip-preset', type: 'text' | 'shape' | 'hud'): void;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();
const { handleFiles } = useFileManager();

const isOpenLocal = computed({
  get: () => props.isOpen,
  set: (val) => {
    if (!val) emit('close');
  },
});

const isMediaPickerOpen = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);

function addAdjustment() {
  const trackId = timelineStore.resolveMobileTargetTrackId('video');
  timelineStore.addAdjustmentClipAtPlayhead({ pseudo: true, trackId });
  emit('close');
}

function addBackground() {
  const trackId = timelineStore.resolveMobileTargetTrackId('video');
  timelineStore.addBackgroundClipAtPlayhead({ pseudo: true, trackId });
  emit('close');
}

function openVirtualClipPreset(type: 'text' | 'shape' | 'hud') {
  isOpenLocal.value = false;
  emit('open-virtual-clip-preset', type);
}

function triggerUpload() {
  fileInputRef.value?.click();
}

async function onFilesSelected(e: Event) {
  const input = e.target as HTMLInputElement;
  if (!input.files?.length) return;
  const files = Array.from(input.files);
  input.value = '';
  emit('close');
  await handleFiles(files);
}

function openMediaPicker() {
  isMediaPickerOpen.value = true;
}

function addVideoTrack() {
  const count = timelineStore.timelineDoc?.tracks.filter((t) => t.kind === 'video').length || 0;
  timelineStore.addTrack('video', `Video ${count + 1}`);
  emit('close');
}

function addAudioTrack() {
  const count = timelineStore.timelineDoc?.tracks.filter((t) => t.kind === 'audio').length || 0;
  timelineStore.addTrack('audio', `Audio ${count + 1}`);
  emit('close');
}
</script>

<template>
  <UiMobileDrawer
    v-model:open="isOpenLocal"
    :title="t('fastcat.timeline.addContent', 'Add content')"
    direction="bottom"
  >
    <div class="px-4 pb-8 flex flex-col gap-3">
      <!-- Virtual clip types -->
      <p class="text-xs font-semibold uppercase tracking-widest text-ui-text-muted px-1 mt-1">
        {{ t('fastcat.timeline.virtualClips', 'Virtual clips') }}
      </p>

      <div class="grid grid-cols-3 gap-2">
        <button
          class="flex flex-col items-center gap-2 rounded-2xl bg-ui-bg border border-ui-border px-3 py-4 text-center transition-all active:scale-95"
          @click="addAdjustment"
        >
          <UIcon name="lucide:sliders-horizontal" class="w-6 h-6 text-blue-400" />
          <span class="text-xs font-medium leading-tight text-ui-text">
            {{ t('fastcat.timeline.adjustment', 'Adjustment') }}
          </span>
        </button>

        <button
          class="flex flex-col items-center gap-2 rounded-2xl bg-ui-bg border border-ui-border px-3 py-4 text-center transition-all active:scale-95"
          @click="addBackground"
        >
          <UIcon name="lucide:square" class="w-6 h-6 text-emerald-400" />
          <span class="text-xs font-medium leading-tight text-ui-text">
            {{ t('fastcat.timeline.background', 'Background') }}
          </span>
        </button>

        <button
          class="flex flex-col items-center gap-2 rounded-2xl bg-ui-bg border border-ui-border px-3 py-4 text-center transition-all active:scale-95"
          @click="openVirtualClipPreset('text')"
        >
          <UIcon name="lucide:type" class="w-6 h-6 text-purple-400" />
          <span class="text-xs font-medium leading-tight text-ui-text">
            {{ t('fastcat.timeline.text', 'Text') }}
          </span>
        </button>

        <button
          class="flex flex-col items-center gap-2 rounded-2xl bg-ui-bg border border-ui-border px-3 py-4 text-center transition-all active:scale-95"
          @click="openVirtualClipPreset('shape')"
        >
          <UIcon name="lucide:shapes" class="w-6 h-6 text-orange-400" />
          <span class="text-xs font-medium leading-tight text-ui-text">
            {{ t('fastcat.timeline.shape', 'Shape') }}
          </span>
        </button>

        <button
          class="flex flex-col items-center gap-2 rounded-2xl bg-ui-bg border border-ui-border px-3 py-4 text-center transition-all active:scale-95"
          @click="openVirtualClipPreset('hud')"
        >
          <UIcon name="lucide:layout-template" class="w-6 h-6 text-cyan-400" />
          <span class="text-xs font-medium leading-tight text-ui-text">
            {{ t('fastcat.timeline.hud', 'HUD') }}
          </span>
        </button>
      </div>

      <div class="h-px bg-ui-border my-1" />

      <!-- Media -->
      <p class="text-xs font-semibold uppercase tracking-widest text-ui-text-muted px-1">
        {{ t('fastcat.timeline.media', 'Media') }}
      </p>

      <button
        class="flex items-center gap-3 w-full rounded-2xl bg-ui-bg border border-ui-border px-4 py-3.5 text-left transition-all active:scale-[0.98]"
        @click="triggerUpload"
      >
        <div class="w-9 h-9 rounded-xl bg-primary-500/15 flex items-center justify-center shrink-0">
          <UIcon name="lucide:upload" class="w-5 h-5 text-primary-400" />
        </div>
        <div class="flex flex-col min-w-0">
          <span class="text-sm font-semibold text-ui-text">
            {{ t('videoEditor.fileManager.upload.title', 'Upload') }}
          </span>
          <span class="text-xs text-ui-text-muted leading-tight">
            {{ t('fastcat.timeline.uploadAutoHint', 'Files are automatically sorted') }}
          </span>
        </div>
        <UIcon name="lucide:chevron-right" class="w-4 h-4 text-ui-text-muted ml-auto shrink-0" />
      </button>

      <button
        class="flex items-center gap-3 w-full rounded-2xl bg-ui-bg border border-ui-border px-4 py-3.5 text-left transition-all active:scale-[0.98]"
        @click="openMediaPicker"
      >
        <div class="w-9 h-9 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0">
          <UIcon name="lucide:folder-open" class="w-5 h-5 text-amber-400" />
        </div>
        <div class="flex flex-col min-w-0">
          <span class="text-sm font-semibold text-ui-text">
            {{ t('fastcat.timeline.fromProjectFiles', 'From project files') }}
          </span>
          <span class="text-xs text-ui-text-muted leading-tight">
            {{ t('fastcat.timeline.fromProjectFilesHint', 'Browse and select media') }}
          </span>
        </div>
        <UIcon name="lucide:chevron-right" class="w-4 h-4 text-ui-text-muted ml-auto shrink-0" />
      </button>

      <div class="h-px bg-ui-border my-1" />

      <!-- Tracks -->
      <p class="text-xs font-semibold uppercase tracking-widest text-ui-text-muted px-1">
        {{ t('common.tracks', 'Tracks') }}
      </p>

      <div class="grid grid-cols-2 gap-2">
        <button
          class="flex flex-col items-center gap-2 rounded-2xl bg-ui-bg border border-ui-border px-3 py-4 text-center transition-all active:scale-95"
          @click="addVideoTrack"
        >
          <UIcon name="lucide:video" class="w-6 h-6 text-rose-400" />
          <span class="text-xs font-medium leading-tight text-ui-text">
            {{ t('fastcat.timeline.addVideoTrack', 'Add video track') }}
          </span>
        </button>

        <button
          class="flex flex-col items-center gap-2 rounded-2xl bg-ui-bg border border-ui-border px-3 py-4 text-center transition-all active:scale-95"
          @click="addAudioTrack"
        >
          <UIcon name="lucide:music" class="w-6 h-6 text-indigo-400" />
          <span class="text-xs font-medium leading-tight text-ui-text">
            {{ t('fastcat.timeline.addAudioTrack', 'Add audio track') }}
          </span>
        </button>
      </div>
    </div>
  </UiMobileDrawer>

  <input
    ref="fileInputRef"
    type="file"
    multiple
    accept="video/*,audio/*,image/*"
    class="hidden"
    @change="onFilesSelected"
  />

  <MobileMediaPickerDrawer :is-open="isMediaPickerOpen" @close="isMediaPickerOpen = false" />
</template>
