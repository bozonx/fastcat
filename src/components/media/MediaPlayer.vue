<script setup lang="ts">
import { ref, watch, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { useImagePanZoom } from '~/composables/preview/useImagePanZoom';
import { useMediaPlayerVolume } from '~/composables/preview/useMediaPlayerVolume';
import { useMediaPlayerPlayback } from '~/composables/preview/useMediaPlayerPlayback';
import { formatTime } from '~/utils/time';
import UiVolumeControl from '~/components/ui/editor/UiVolumeControl.vue';
import { useUiStore } from '~/stores/ui.store';
import { useFocusStore } from '~/stores/focus.store';

interface MediaPlaybackTransferState {
  currentTime: number;
  isPlaying: boolean;
  token: number;
  source: 'inline' | 'modal';
}

const { t } = useI18n();
const uiStore = useUiStore();
const focusStore = useFocusStore();
const { volume, isMuted } = useMediaPlayerVolume();

const props = defineProps<{
  src: string;
  type: 'video' | 'audio';
  isModal?: boolean;
  focusPanelId?: string;
  resumeState?: MediaPlaybackTransferState | null;
  instanceKey?: 'inline' | 'modal';
  forcePaused?: boolean;
}>();

const emit = defineEmits<{
  (e: 'open-modal'): void;
  (e: 'close-modal'): void;
  (
    e: 'sync-state',
    value: { currentTime: number; isPlaying: boolean; source: 'inline' | 'modal' },
  ): void;
}>();

const mediaElement = ref<HTMLVideoElement | HTMLAudioElement | null>(null);
const playerRootEl = ref<HTMLElement | null>(null);

const {
  isPlaying,
  currentTime,
  duration,
  progress,
  playbackSpeed,
  togglePlay,
  setForwardPlaybackSpeed,
  setBackwardPlaybackSpeed,
  onTimeUpdate: playOnTimeUpdate,
  onLoadedMetadata,
  onPlay,
  onPause,
  resetState: resetPlaybackState,
  pauseAndClearPlayback,
} = useMediaPlayerPlayback(mediaElement, props, volume, isMuted, focusStore);

function onTimeUpdate() {
  playOnTimeUpdate(isDragging);
  emitPlaybackState();
}

const playbackSpeedLabel = computed(() => {
  const s = playbackSpeed.value;
  if (!Number.isFinite(s)) return null;
  if (Math.abs(s - 1) < 1e-6) return null;
  const normalized = Math.round(s * 100) / 100;
  return `${normalized}x`;
});

const isDragging = ref(false);
const wasPlayingBeforeDrag = ref(false);

const containerRef = ref<HTMLElement | null>(null);

const {
  scale,
  translateX,
  translateY,
  isReady,
  reset: resetZoom,
  fitToContainer,
  onWheel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onAuxClick,
  onCustomZoom,
} = useImagePanZoom(containerRef);

const mediaStyle = computed(() => ({
  transform: `translate(${translateX.value}px, ${translateY.value}px) scale(${scale.value})`,
  transformOrigin: 'center',
}));

const contextMenuItems = computed(() => [
  [
    {
      label: t('fastcat.preview.fitToWindow'),
      icon: 'i-heroicons-arrows-pointing-in',
      onSelect: () => fitToContainer(),
      click: () => fitToContainer(),
    },
    {
      label: t('fastcat.preview.resetZoom'),
      icon: 'i-heroicons-arrow-path',
      onSelect: () => resetZoom(),
      click: () => resetZoom(),
    },
  ],
]);

function emitPlaybackState() {
  if (props.forcePaused) return;
  emit('sync-state', {
    currentTime: currentTime.value,
    isPlaying: isPlaying.value,
    source: props.instanceKey ?? 'inline',
  });
}

function zoomIn() {
  onCustomZoom(new CustomEvent('fastcat-zoom', { detail: { dir: 1 } }));
}

function zoomOut() {
  onCustomZoom(new CustomEvent('fastcat-zoom', { detail: { dir: -1 } }));
}

async function applyResumeState() {
  if (!props.resumeState || !mediaElement.value) return;
  if (props.resumeState.source === (props.instanceKey ?? 'inline')) return;

  const element = mediaElement.value;
  const nextTime = Math.max(0, props.resumeState.currentTime);

  if (props.type === 'video' || props.type === 'audio') {
    const setTime = () => {
      if (!mediaElement.value) return;
      if (Number.isFinite(nextTime)) {
        mediaElement.value.currentTime = nextTime;
      }
      if (props.resumeState?.isPlaying) {
        void mediaElement.value.play().catch(() => {});
      } else {
        mediaElement.value.pause();
      }
    };

    if (element.readyState >= 1) {
      setTime();
      return;
    }

    const onLoaded = () => {
      element.removeEventListener('loadedmetadata', onLoaded);
      setTime();
    };

    element.addEventListener('loadedmetadata', onLoaded, { once: true });
  }
}

function onSeekStart() {
  isDragging.value = true;
  if (isPlaying.value) {
    wasPlayingBeforeDrag.value = true;
    mediaElement.value?.pause();
  } else {
    wasPlayingBeforeDrag.value = false;
  }
}

function onSeek() {
  if (!mediaElement.value || duration.value === 0) return;
  mediaElement.value.currentTime = currentTime.value;
  progress.value = (currentTime.value / duration.value) * 100;
}

function onSeekEnd() {
  isDragging.value = false;
  if (wasPlayingBeforeDrag.value) {
    mediaElement.value?.play();
  }
}

// Reset state when src changes
watch(
  () => props.src,
  () => {
    resetPlaybackState();
    resetZoom();

    if (mediaElement.value) {
      mediaElement.value.volume = Math.min(1, Math.max(0, volume.value));
      mediaElement.value.muted = isMuted.value;
    }
  },
);

watch(volume, (v) => {
  if (mediaElement.value) {
    mediaElement.value.volume = Math.min(1, Math.max(0, v));
  }
});

watch(isMuted, (m) => {
  if (mediaElement.value) {
    mediaElement.value.muted = m;
  }
});

watch(
  () => props.forcePaused,
  (forcePaused) => {
    if (!mediaElement.value || !forcePaused) return;
    mediaElement.value.pause();
  },
  { immediate: true },
);

watch(
  () => props.resumeState?.token,
  async () => {
    await nextTick();
    await applyResumeState();
  },
);

watch(isPlaying, () => {
  emitPlaybackState();
});

watch(currentTime, () => {
  emitPlaybackState();
});

function shouldHandlePreviewEvent() {
  if (props.isModal) return true;
  if (!playerRootEl.value) return false;
  if (!props.focusPanelId) return focusStore.canUsePreviewHotkeys;
  return focusStore.isPanelFocused(props.focusPanelId as any);
}

watch(
  () => uiStore.previewZoomTrigger,
  (trigger) => {
    if (!shouldHandlePreviewEvent() || !trigger.timestamp) return;

    onCustomZoom(
      new CustomEvent('fastcat-zoom', { detail: { dir: trigger.dir, target: 'preview' } }),
    );
  },
  { deep: true },
);

watch(
  () => uiStore.previewZoomResetTrigger,
  (timestamp) => {
    if (!shouldHandlePreviewEvent() || !timestamp) return;

    resetZoom();
  },
);

watch(
  () => uiStore.previewZoomFitTrigger,
  (timestamp) => {
    if (!shouldHandlePreviewEvent() || !timestamp) return;

    fitToContainer();
  },
);

function toggleMute() {
  isMuted.value = !isMuted.value;
}

const isIdle = ref(false);
let idleTimer: number | undefined;

function resetIdle() {
  isIdle.value = false;
  if (idleTimer) window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    isIdle.value = true;
  }, 2000);
}

function onGlobalMouseMove() {
  resetIdle();
}

onMounted(() => {
  window.addEventListener('mousemove', onGlobalMouseMove);
  void nextTick(async () => {
    await applyResumeState();
    emitPlaybackState();
  });
});

onUnmounted(() => {
  window.removeEventListener('mousemove', onGlobalMouseMove);
  if (idleTimer) window.clearTimeout(idleTimer);
});
</script>

<template>
  <div ref="playerRootEl" class="flex flex-col w-full h-full overflow-hidden rounded">
    <!-- Video -->
    <UContextMenu
      v-if="type === 'video'"
      :items="contextMenuItems"
      :modal="false"
      class="flex-1 flex min-h-0"
      :ui="{ content: 'z-[100000]' }"
    >
      <div
        ref="containerRef"
        class="media-player-container relative w-full h-full bg-black overflow-hidden flex items-center justify-center select-none outline-none"
        tabindex="-1"
        @wheel="onWheel"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointerleave="onPointerUp"
        @auxclick="onAuxClick"
      >
        <video
          ref="mediaElement"
          :src="src"
          class="max-w-full max-h-full object-contain transition-transform duration-75"
          :class="isReady ? 'opacity-100' : 'opacity-0'"
          :style="mediaStyle"
          @timeupdate="onTimeUpdate"
          @loadedmetadata="
            onLoadedMetadata();
            fitToContainer();
          "
          @play="onPlay"
          @pause="onPause"
          @ended="onPause"
          @click="togglePlay"
          @dblclick.prevent="resetZoom"
        ></video>
      </div>
    </UContextMenu>

    <!-- Audio -->
    <div v-else class="flex-1 flex flex-col min-h-0 bg-ui-bg">
      <audio
        ref="mediaElement"
        :src="src"
        class="hidden"
        @timeupdate="onTimeUpdate"
        @loadedmetadata="onLoadedMetadata"
        @play="onPlay"
        @pause="onPause"
        @ended="onPause"
      ></audio>

      <div class="flex-1 min-h-0 flex items-center justify-center bg-(--media-bg) relative">
        <div
          class="absolute inset-0 opacity-30"
          style="
            background:
              radial-gradient(circle at 30% 30%, rgba(34, 197, 94, 0.35), transparent 60%),
              radial-gradient(circle at 80% 70%, rgba(59, 130, 246, 0.25), transparent 55%);
          "
        />
        <div
          class="relative flex flex-col items-center justify-center text-ui-text-muted px-6 py-4"
        >
          <div
            class="w-16 h-16 rounded-2xl bg-ui-bg-elevated/60 border border-ui-border flex items-center justify-center shrink-0 shadow-inner"
          >
            <UIcon name="i-heroicons-musical-note" class="w-8 h-8 opacity-70" />
          </div>
          <div
            class="mt-4 text-2xs sm:text-xs uppercase tracking-wider opacity-70 text-center font-medium"
          >
            {{ t('fastcat.preview.audioTrack') }}
          </div>
        </div>
      </div>
    </div>

    <!-- Controls -->
    <div
      class="flex flex-col shrink-0 gap-2 transition-all duration-300"
      :class="[
        isModal
          ? 'absolute bottom-8 left-1/2 -translate-x-1/2 w-[90%] max-w-2xl bg-ui-bg-elevated/80 backdrop-blur-md rounded-xl border border-ui-border shadow-2xl p-4 z-50'
          : 'px-4 py-3 border-t border-ui-border bg-ui-bg-elevated',
        isModal && isIdle ? 'opacity-0 translate-y-4 pointer-events-none' : 'opacity-100',
      ]"
      @mouseenter="resetIdle"
    >
      <div class="w-full relative flex items-center h-4 group">
        <input
          v-model.number="currentTime"
          type="range"
          min="0"
          :max="duration || 100"
          step="0.01"
          class="w-full absolute inset-0 opacity-0 cursor-pointer z-10"
          @input="onSeek"
          @mousedown="onSeekStart"
          @mouseup="onSeekEnd"
          @touchstart="onSeekStart"
          @touchend="onSeekEnd"
        />
        <div class="h-2 bg-ui-bg-accent rounded-full w-full relative pointer-events-none">
          <div
            class="absolute top-0 left-0 h-full bg-primary-500 rounded-full pointer-events-none"
            :style="{ width: `${progress}%` }"
          ></div>
          <div
            class="absolute top-1/2 -mt-1.5 w-3 h-3 bg-white rounded-full shadow transition-transform scale-0 group-hover/controls:scale-100 pointer-events-none"
            :style="{ left: `calc(${progress}% - 6px)` }"
          ></div>
        </div>
      </div>

      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <UButton
            size="sm"
            variant="solid"
            color="primary"
            :icon="isPlaying ? 'i-heroicons-pause' : 'i-heroicons-play'"
            @click="togglePlay"
          />
          <span class="text-xs text-ui-text-muted font-mono">
            {{ formatTime(currentTime) }} / {{ formatTime(duration) }}
          </span>
          <span
            v-if="playbackSpeedLabel"
            class="text-2xs px-2 py-0.5 rounded-full border border-ui-border bg-ui-bg text-ui-text-muted font-mono"
          >
            {{ playbackSpeedLabel }}
          </span>
        </div>

        <div class="flex items-center gap-2">
          <UButtonGroup v-if="type === 'video'" size="sm" variant="ghost" color="neutral">
            <UTooltip :text="t('fastcat.preview.zoomIn')">
              <UButton
                icon="i-heroicons-magnifying-glass-plus"
                class="hover:bg-ui-bg-accent"
                @click="zoomIn"
              />
            </UTooltip>
            <UTooltip :text="t('fastcat.preview.zoomOut')">
              <UButton
                icon="i-heroicons-magnifying-glass-minus"
                class="hover:bg-ui-bg-accent"
                @click="zoomOut"
              />
            </UTooltip>
            <UTooltip :text="t('fastcat.preview.resetZoom')">
              <UButton icon="i-heroicons-arrow-path" class="hover:bg-ui-bg-accent" @click="resetZoom" />
            </UTooltip>
          </UButtonGroup>

          <UiVolumeControl
            v-model:volume="volume"
            v-model:is-muted="isMuted"
            :compact="!isModal"
            orientation="horizontal"
            :max="1"
          />
          <UButton
            v-if="type === 'video'"
            size="sm"
            variant="ghost"
            color="neutral"
            :icon="isModal ? 'i-heroicons-arrows-pointing-in' : 'i-heroicons-arrows-pointing-out'"
            @click="isModal ? emit('close-modal') : emit('open-modal')"
          />
        </div>
      </div>
    </div>
  </div>
</template>
