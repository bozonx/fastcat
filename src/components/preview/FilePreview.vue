<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import MediaPlayer from '~/components/media/MediaPlayer.vue';
import ImageViewer from '~/components/preview/ImageViewer.vue';
import TextEditor from '~/components/preview/TextEditor.vue';
import { useUiStore } from '~/stores/ui.store';
import type { PanelFocusId } from '~/stores/focus.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { computed } from 'vue';
import { DEFAULT_HOTKEYS } from '~/utils/hotkeys/defaultHotkeys';
import { getEffectiveHotkeyBindings } from '~/utils/hotkeys/effectiveHotkeys';
import {
  createDefaultHotkeyLookup,
  createHotkeyLookup,
  isCommandMatched,
} from '~/utils/hotkeys/runtime';

interface MediaPlaybackTransferState {
  currentTime: number;
  isPlaying: boolean;
  token: number;
  source: 'inline' | 'modal';
}

const { t } = useI18n();
const uiStore = useUiStore();
const workspaceStore = useWorkspaceStore();

const commandOrder = DEFAULT_HOTKEYS.commands.map((c) => c.id);
const effectiveHotkeys = computed(() =>
  getEffectiveHotkeyBindings(workspaceStore.userSettings.hotkeys),
);
const hotkeyLookup = computed(() => createHotkeyLookup(effectiveHotkeys.value, commandOrder));
const defaultHotkeyLookup = computed(() => createDefaultHotkeyLookup(commandOrder));

const props = defineProps<{
  url?: string | null;
  mediaType: 'video' | 'audio' | 'image' | 'text' | 'unknown' | null;
  textContent?: string;
  alt?: string;
  filePath?: string;
  fileName?: string;
  focusPanelId?: PanelFocusId;
}>();

const isMediaModalOpen = ref(false);
const isTextModalOpen = ref(false);
const mediaPlaybackState = ref<MediaPlaybackTransferState | null>(null);

function blurActiveElement() {
  (document.activeElement as HTMLElement | null)?.blur?.();
}

function openMediaModal() {
  blurActiveElement();
  isMediaModalOpen.value = true;
}

function closeMediaModal() {
  blurActiveElement();
  isMediaModalOpen.value = false;
}

function onMediaSyncState(payload: {
  currentTime: number;
  isPlaying: boolean;
  source: 'inline' | 'modal';
}) {
  mediaPlaybackState.value = {
    currentTime: payload.currentTime,
    isPlaying: payload.isPlaying,
    source: payload.source,
    token: Date.now(),
  };
}

watch(
  () => uiStore.previewFullscreenToggleTrigger,
  (timestamp) => {
    if (!timestamp) return;
    blurActiveElement();
    if (props.mediaType === 'text') {
      isTextModalOpen.value = !isTextModalOpen.value;
    } else if (props.mediaType !== 'audio') {
      isMediaModalOpen.value = !isMediaModalOpen.value;
    }
  },
);

function handleEsc(e: KeyboardEvent) {
  const isCancel = isCommandMatched({
    event: e,
    cmdId: 'general.deselect',
    userSettings: workspaceStore.userSettings,
    hotkeyLookup: hotkeyLookup.value,
    defaultHotkeyLookup: defaultHotkeyLookup.value,
  });

  if (isCancel) {
    if (isMediaModalOpen.value) {
      isMediaModalOpen.value = false;
      e.stopPropagation();
    } else if (isTextModalOpen.value) {
      isTextModalOpen.value = false;
      e.stopPropagation();
    }
  }
}

watch([isMediaModalOpen, isTextModalOpen], ([mm, tm], [oldMm, oldTm]) => {
  const nowOpen = mm || tm;
  const wasOpen = oldMm || oldTm;
  if (nowOpen && !wasOpen) {
    uiStore.activeModalsCount++;
  } else if (!nowOpen && wasOpen) {
    uiStore.activeModalsCount--;
  }
});

onMounted(() => {
  window.addEventListener('keydown', handleEsc, { capture: true });
});

onUnmounted(() => {
  if (isMediaModalOpen.value || isTextModalOpen.value) {
    uiStore.activeModalsCount--;
  }
  window.removeEventListener('keydown', handleEsc, { capture: true });
});
</script>

<template>
  <div class="w-full h-full flex flex-col overflow-hidden relative group/preview">
    <template v-if="props.mediaType === 'image' && props.url">
      <ImageViewer
        :src="props.url"
        :alt="props.alt"
        :is-modal="false"
        :focus-panel-id="props.focusPanelId"
        class="w-full h-full"
        @open-modal="openMediaModal"
      />
    </template>

    <template v-else-if="(props.mediaType === 'video' || props.mediaType === 'audio') && props.url">
      <MediaPlayer
        :src="props.url"
        :type="props.mediaType"
        :is-modal="false"
        instance-key="inline"
        :resume-state="mediaPlaybackState"
        :force-paused="isMediaModalOpen"
        :focus-panel-id="props.focusPanelId"
        class="w-full h-full"
        @open-modal="props.mediaType !== 'audio' && openMediaModal()"
        @sync-state="onMediaSyncState"
      />
    </template>

    <TextEditor
      v-else-if="props.mediaType === 'text'"
      v-model:is-modal-open="isTextModalOpen"
      :file-path="props.filePath || ''"
      :file-name="props.fileName"
      :initial-content="props.textContent || ''"
      :focus-panel-id="props.focusPanelId"
      class="w-full h-full"
    />

    <div
      v-else-if="props.mediaType === 'unknown'"
      class="flex flex-col items-center justify-center h-full w-full gap-3 text-ui-text-muted p-8 bg-ui-bg"
    >
      <UIcon name="i-heroicons-document" class="w-16 h-16" />
      <p class="text-sm text-center">
        {{ t('fastcat.preview.unsupported', 'Unsupported file format for visual preview') }}
      </p>
    </div>
  </div>

  <!-- Full-screen modal teleported to body to escape any stacking context -->
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 scale-95"
      enter-to-class="opacity-100 scale-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100 scale-100"
      leave-to-class="opacity-0 scale-95"
    >
      <div
        v-if="isMediaModalOpen"
        style="position: fixed; inset: 0; z-index: 99999; background: black"
        @click.self="closeMediaModal"
      >
        <div class="absolute top-3 right-3 z-10">
          <UButton
            size="sm"
            variant="ghost"
            color="neutral"
            icon="i-heroicons-x-mark"
            class="bg-black/40 hover:bg-black/60"
            @click="closeMediaModal"
          />
        </div>

        <template v-if="props.mediaType === 'image' && props.url">
          <ImageViewer
            :src="props.url"
            :alt="props.alt"
            :is-modal="true"
            :focus-panel-id="props.focusPanelId"
            class="w-full h-full"
            @close-modal="closeMediaModal"
          />
        </template>

        <template v-else-if="props.mediaType === 'video' && props.url">
          <MediaPlayer
            :src="props.url"
            type="video"
            :is-modal="true"
            instance-key="modal"
            :resume-state="mediaPlaybackState"
            :focus-panel-id="props.focusPanelId"
            class="w-full h-full"
            @close-modal="closeMediaModal"
            @sync-state="onMediaSyncState"
          />
        </template>
      </div>
    </Transition>
  </Teleport>
</template>
