<script setup lang="ts">
import { ref, watch, computed, onMounted, onUnmounted } from 'vue';
import { useImagePanZoom } from '~/composables/preview/useImagePanZoom';
import { useMediaPlayerVolume } from '~/composables/preview/useMediaPlayerVolume';
import { useMediaPlayerPlayback } from '~/composables/preview/useMediaPlayerPlayback';
import { formatTime } from '~/utils/time';
import VolumeControl from '~/components/common/VolumeControl.vue';
import { useUiStore } from '~/stores/ui.store';
import { useFocusStore } from '~/stores/focus.store';

const { t } = useI18n();
const uiStore = useUiStore();
const focusStore = useFocusStore();
const { volume, isMuted } = useMediaPlayerVolume();

const props = defineProps<{
  src: string;
  type: 'video' | 'audio';
  isModal?: boolean;
  focusPanelId?: string;
}>();

const emit = defineEmits<{
  (e: 'open-modal'): void;
  (e: 'close-modal'): void;
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
  reset: resetZoom,
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
      label: t('fastcat.preview.resetZoom', 'Reset Zoom & Pan'),
      icon: 'i-heroicons-arrow-path',
      onSelect: () => resetZoom(),
      click: () => resetZoom(),
    },
  ],
]);

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

function shouldHandlePreviewPlaybackEvent() {
  if (!playerRootEl.value || props.isModal) return false;
  if (!props.focusPanelId) return focusStore.canUsePreviewHotkeys;
  return focusStore.effectiveFocus === props.focusPanelId;
}

// UI playback watch logic removed as it is now in useMediaPlayerPlayback composable

watch(
  () => uiStore.previewZoomTrigger,
  (trigger) => {
    if (!shouldHandlePreviewPlaybackEvent() || !trigger.timestamp) return;

    onCustomZoom(
      new CustomEvent('fastcat-zoom', { detail: { dir: trigger.dir, target: 'preview' } }),
    );
  },
  { deep: true },
);

watch(
  () => uiStore.previewZoomResetTrigger,
  (timestamp) => {
    if (!shouldHandlePreviewPlaybackEvent() || !timestamp) return;

    resetZoom();
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
      class="flex-1 flex min-h-0"
      :ui="{ content: 'z-[9999]' }"
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
          :style="mediaStyle"
          @timeupdate="onTimeUpdate"
          @loadedmetadata="onLoadedMetadata"
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
            class="mt-4 text-[10px] sm:text-xs uppercase tracking-wider opacity-70 text-center font-medium"
          >
            {{ t('fastcat.preview.audioTrack', 'Audio Track') }}
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
            class="text-[10px] px-2 py-0.5 rounded-full border border-ui-border bg-ui-bg text-ui-text-muted font-mono"
          >
            {{ playbackSpeedLabel }}
          </span>
        </div>

        <div class="flex items-center gap-2">
          <VolumeControl
            v-model:volume="volume"
            v-model:is-muted="isMuted"
            compact
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

