<script setup lang="ts">
import { ref, computed, nextTick } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import MobileMediaPickerDrawer from './MobileMediaPickerDrawer.vue';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import { useMediaStore } from '~/stores/media.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { secondsToUs } from '~/utils/time';

import { useAppClipboard } from '~/composables/useAppClipboard';
import { useMediaTrackRedirectToast } from '~/composables/timeline/useMediaTrackRedirectToast';
import { useCloseModel } from '~/composables/ui/useCloseModel';
import { isInDevelopmentFeaturesEnabled } from '~/utils/features';

const props = defineProps<{
  isOpen: boolean;
  targetTrackId?: string;
}>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'open-virtual-clip-preset', type: 'text' | 'shape' | 'hud'): void;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();
const mediaStore = useMediaStore();
const workspaceStore = useWorkspaceStore();
const { handleFiles } = useFileManager();
const clipboardStore = useAppClipboard();
const { captureSelectionKind, notifyRedirect } = useMediaTrackRedirectToast();
const toast = useToast();

const isOpenLocal = useCloseModel(
  () => props.isOpen,
  () => emit('close'),
);

const isMediaPickerOpen = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);

const runtimeConfig = useRuntimeConfig();
const isDev = isInDevelopmentFeaturesEnabled(runtimeConfig);

const hasClipboard = computed(() => clipboardStore.hasTimelinePayload);

async function resolveInsertDurationUs(
  path: string,
  mediaType: string,
): Promise<number | undefined> {
  if (mediaType === 'image' || mediaType === 'timeline') {
    return workspaceStore.userSettings.timeline.defaultStaticClipDurationUs;
  }

  const meta = await mediaStore.getOrFetchMetadataByPath(path);
  const duration = Number(meta?.duration);
  return Number.isFinite(duration) && duration > 0 ? secondsToUs(duration) : undefined;
}

async function handlePaste() {
  const payload = clipboardStore.clipboardPayload;
  if (!payload || payload.source !== 'timeline' || payload.items.length === 0) return;

  const playheadUs = timelineStore.currentTime;
  const pastedItemIds = await timelineStore.pasteClips(payload.items, {
    insertStartUs: playheadUs,
  });

  if (pastedItemIds && pastedItemIds.length > 0) {
    if (payload.operation === 'cut') {
      clipboardStore.setClipboardPayload(null);
    }
    emit('close');
  }
}

function addAdjustment() {
  try {
    const trackId =
      props.targetTrackId ??
      timelineStore.resolveMobileTargetTrackId('video', {
        durationUs: workspaceStore.userSettings.timeline.defaultStaticClipDurationUs,
      });
    timelineStore.addAdjustmentClipAtPlayhead({ pseudo: true, trackId });
    if (timelineStore.lastClipTrimmed) {
      toast.add({
        title: t('fastcat.timeline.clipTrimmedToFitGap'),
        color: 'warning',
        icon: 'i-heroicons-exclamation-triangle',
      });
    }
    emit('close');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'cannot_insert_on_clip') {
      toast.add({
        title: t('fastcat.timeline.cannotInsertPlayheadOnClip'),
        color: 'error',
        icon: 'i-heroicons-x-circle',
      });
    } else {
      toast.add({
        title: t('common.error'),
        description: message,
        color: 'error',
      });
    }
  }
}

function addBackground() {
  try {
    const trackId =
      props.targetTrackId ??
      timelineStore.resolveMobileTargetTrackId('video', {
        durationUs: workspaceStore.userSettings.timeline.defaultStaticClipDurationUs,
      });
    timelineStore.addBackgroundClipAtPlayhead({ pseudo: true, trackId });
    if (timelineStore.lastClipTrimmed) {
      toast.add({
        title: t('fastcat.timeline.clipTrimmedToFitGap'),
        color: 'warning',
        icon: 'i-heroicons-exclamation-triangle',
      });
    }
    emit('close');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'cannot_insert_on_clip') {
      toast.add({
        title: t('fastcat.timeline.cannotInsertPlayheadOnClip'),
        color: 'error',
        icon: 'i-heroicons-x-circle',
      });
    } else {
      toast.add({
        title: t('common.error'),
        description: message,
        color: 'error',
      });
    }
  }
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
  const results = await handleFiles(files);
  if (results && results.length > 0) {
    const selectionKind = captureSelectionKind();
    const addedKinds: ('video' | 'audio')[] = [];
    for (const r of results) {
      const mediaType = getMediaTypeFromFilename(r.fileName);
      if (mediaType === 'timeline') {
        try {
          const durationUs = await resolveInsertDurationUs(r.targetPath, mediaType);
          await timelineStore.addTimelineClipToTimelineFromPath({
            trackId: timelineStore.resolveMobileTargetTrackId('video', { durationUs }),
            name: r.fileName,
            path: r.targetPath,
            startUs: timelineStore.currentTime,
            pseudo: true,
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          if (message === 'cannot_insert_on_clip') {
            toast.add({
              title: t('fastcat.timeline.cannotInsertPlayheadOnClip'),
              color: 'error',
              icon: 'i-heroicons-x-circle',
            });
          } else {
            toast.add({
              title: t('common.error'),
              description: message,
              color: 'error',
            });
          }
        }
      } else if (['video', 'audio', 'image'].includes(mediaType)) {
        const kind = mediaType === 'audio' ? 'audio' : 'video';
        const durationUs = await resolveInsertDurationUs(r.targetPath, mediaType);
        const trackId =
          props.targetTrackId ?? timelineStore.resolveMobileTargetTrackId(kind, { durationUs });

        try {
          const result = await timelineStore.addClipToTimelineFromPath({
            trackId,
            name: r.fileName,
            path: r.targetPath,
            startUs: timelineStore.currentTime,
            pseudo: true,
          });
          if (result.warnings?.some((w) => w.type === 'clipTrimmed')) {
            toast.add({
              title: t('fastcat.timeline.clipTrimmedToFitGap'),
              color: 'warning',
              icon: 'i-heroicons-exclamation-triangle',
            });
          }
          // Use the resolved track's actual kind: props.targetTrackId can override the
          // media-derived kind, so the clip may not land on a track of `kind`.
          const placedKind =
            timelineStore.timelineDoc?.tracks.find((t) => t.id === trackId)?.kind ?? kind;
          addedKinds.push(placedKind);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          if (message === 'cannot_insert_on_clip') {
            toast.add({
              title: t('fastcat.timeline.cannotInsertPlayheadOnClip'),
              color: 'error',
              icon: 'i-heroicons-x-circle',
            });
          } else {
            toast.add({
              title: t('common.error'),
              description: message,
              color: 'error',
            });
          }
        }
      }
    }
    if (addedKinds.length > 0) {
      notifyRedirect(selectionKind, addedKinds);
    }
  }
}

function openMediaPicker() {
  isOpenLocal.value = false;
  nextTick(() => {
    isMediaPickerOpen.value = true;
  });
}
</script>

<template>
  <UiMobileDrawer v-model:open="isOpenLocal" :show-close="false">
    <div class="px-4 pb-8 flex flex-col gap-3">
      <!-- Paste -->
      <Transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="transform -translate-y-2 opacity-0"
        enter-to-class="transform translate-y-0 opacity-100"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="transform translate-y-0 opacity-100"
        leave-to-class="transform -translate-y-2 opacity-0"
      >
        <button
          v-if="hasClipboard"
          class="flex items-center gap-3 w-full rounded-2xl bg-blue-500/10 border border-blue-500/30 px-4 py-4 text-left transition-all active:scale-[0.98] mb-1 group"
          @click="handlePaste"
        >
          <div
            class="w-10 h-10 rounded-xl bg-blue-500 flex items-center justify-center shrink-0 shadow-lg shadow-blue-500/20 group-active:scale-90 transition-transform"
          >
            <UIcon name="i-heroicons-clipboard-document-check" class="w-6 h-6 text-white" />
          </div>
          <div class="flex flex-col min-w-0">
            <span class="text-sm font-bold text-blue-400">
              {{ t('common.paste') }}
            </span>
            <span
              class="text-[10px] text-blue-400/60 leading-tight uppercase tracking-widest font-bold"
            >
              {{ t('fastcat.timeline.pasteAtPlayhead') }}
            </span>
          </div>
          <UIcon name="lucide:chevron-right" class="w-4 h-4 text-blue-400/40 ml-auto shrink-0" />
        </button>
      </Transition>

      <div v-if="hasClipboard" class="h-px bg-ui-border my-1" />

      <!-- Virtual clip types -->
      <p class="text-xs font-semibold uppercase tracking-widest text-ui-text-muted px-1 mt-1">
        {{ t('fastcat.timeline.virtualClips') }}
      </p>

      <div class="grid grid-cols-3 gap-2">
        <button
          class="flex flex-col items-center gap-2 rounded-2xl bg-ui-bg border border-ui-border px-3 py-4 text-center transition-all active:scale-95"
          @click="addAdjustment"
        >
          <UIcon name="lucide:sliders-horizontal" class="w-6 h-6 text-blue-400" />
          <span class="text-xs font-medium leading-tight text-ui-text">
            {{ t('fastcat.timeline.adjustment') }}
          </span>
        </button>

        <button
          class="flex flex-col items-center gap-2 rounded-2xl bg-ui-bg border border-ui-border px-3 py-4 text-center transition-all active:scale-95"
          @click="addBackground"
        >
          <UIcon name="lucide:square" class="w-6 h-6 text-emerald-400" />
          <span class="text-xs font-medium leading-tight text-ui-text">
            {{ t('fastcat.timeline.background') }}
          </span>
        </button>

        <button
          class="flex flex-col items-center gap-2 rounded-2xl bg-ui-bg border border-ui-border px-3 py-4 text-center transition-all active:scale-95"
          @click="openVirtualClipPreset('text')"
        >
          <UIcon name="lucide:type" class="w-6 h-6 text-purple-400" />
          <span class="text-xs font-medium leading-tight text-ui-text">
            {{ t('fastcat.timeline.text') }}
          </span>
        </button>

        <button
          v-if="isDev"
          class="flex flex-col items-center gap-2 rounded-2xl bg-ui-bg border border-ui-border px-3 py-4 text-center transition-all active:scale-95"
          @click="openVirtualClipPreset('shape')"
        >
          <UIcon name="lucide:shapes" class="w-6 h-6 text-orange-400" />
          <span class="text-xs font-medium leading-tight text-ui-text">
            {{ t('fastcat.timeline.shape') }}
          </span>
        </button>

        <button
          v-if="isDev"
          class="flex flex-col items-center gap-2 rounded-2xl bg-ui-bg border border-ui-border px-3 py-4 text-center transition-all active:scale-95"
          @click="openVirtualClipPreset('hud')"
        >
          <UIcon name="lucide:layout-template" class="w-6 h-6 text-cyan-400" />
          <span class="text-xs font-medium leading-tight text-ui-text">
            {{ t('fastcat.timeline.hud') }}
          </span>
        </button>
      </div>

      <div class="h-px bg-ui-border my-1" />

      <!-- Media -->
      <p class="text-xs font-semibold uppercase tracking-widest text-ui-text-muted px-1">
        {{ t('fastcat.timeline.media') }}
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
            {{ t('videoEditor.fileManager.upload.title') }}
          </span>
          <span class="text-xs text-ui-text-muted leading-tight">
            {{ t('fastcat.timeline.uploadAutoHint') }}
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
            {{ t('fastcat.timeline.fromProjectFiles') }}
          </span>
          <span class="text-xs text-ui-text-muted leading-tight">
            {{ t('fastcat.timeline.fromProjectFilesHint') }}
          </span>
        </div>
        <UIcon name="lucide:chevron-right" class="w-4 h-4 text-ui-text-muted ml-auto shrink-0" />
      </button>
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
