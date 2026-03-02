<script setup lang="ts">
import { ref, watch } from 'vue';

const { t } = useI18n();

const props = defineProps<{
  src: string;
  type: 'video' | 'audio';
}>();

const mediaElement = ref<HTMLVideoElement | HTMLAudioElement | null>(null);
const isPlaying = ref(false);
const currentTime = ref(0);
const duration = ref(0);
const progress = ref(0);

function togglePlay() {
  if (!mediaElement.value) return;
  if (isPlaying.value) {
    mediaElement.value.pause();
  } else {
    mediaElement.value.play();
  }
}

function onTimeUpdate() {
  if (!mediaElement.value || isDragging.value) return;
  currentTime.value = mediaElement.value.currentTime;
  if (duration.value > 0) {
    progress.value = (currentTime.value / duration.value) * 100;
  }
}

function onLoadedMetadata() {
  if (!mediaElement.value) return;
  duration.value = mediaElement.value.duration;
}

function onPlay() {
  isPlaying.value = true;
}

function onPause() {
  isPlaying.value = false;
}

function formatTime(seconds: number) {
  if (!seconds || isNaN(seconds)) return '00:00';
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${s}`;
}

const isDragging = ref(false);
const wasPlayingBeforeDrag = ref(false);

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
    isPlaying.value = false;
    currentTime.value = 0;
    progress.value = 0;
    duration.value = 0;
  },
);
</script>

<template>
  <div class="flex flex-col w-full h-full overflow-hidden rounded">
    <!-- Video -->
    <div
      v-if="type === 'video'"
      class="flex-1 flex items-center justify-center min-h-0 bg-(--media-bg) relative"
    >
      <video
        ref="mediaElement"
        :src="src"
        class="max-w-full max-h-full object-contain"
        @timeupdate="onTimeUpdate"
        @loadedmetadata="onLoadedMetadata"
        @play="onPlay"
        @pause="onPause"
        @ended="onPause"
        @click="togglePlay"
      ></video>
    </div>

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
        <div class="relative flex flex-col items-center justify-center text-ui-text-muted px-6 py-4">
          <div
            class="w-16 h-16 rounded-2xl bg-ui-bg-elevated/60 border border-ui-border flex items-center justify-center shrink-0 shadow-inner"
          >
            <UIcon name="i-heroicons-musical-note" class="w-8 h-8 opacity-70" />
          </div>
          <div class="mt-4 text-[10px] sm:text-xs uppercase tracking-wider opacity-70 text-center font-medium">
            {{ t('granVideoEditor.preview.audioTrack', 'Audio Track') }}
          </div>
        </div>
      </div>
    </div>

    <!-- Controls -->
    <div class="flex flex-col px-4 py-3 border-t border-ui-border bg-ui-bg-elevated shrink-0 gap-2">
      <div class="w-full relative flex items-center h-4 group">
        <input
          type="range"
          min="0"
          :max="duration || 100"
          step="0.01"
          v-model.number="currentTime"
          @input="onSeek"
          @mousedown="onSeekStart"
          @mouseup="onSeekEnd"
          @touchstart="onSeekStart"
          @touchend="onSeekEnd"
          class="w-full absolute inset-0 opacity-0 cursor-pointer z-10"
        />
        <div class="h-2 bg-ui-bg-accent rounded-full w-full relative pointer-events-none">
          <div
            class="absolute top-0 left-0 h-full bg-primary-500 rounded-full pointer-events-none"
            :style="{ width: `${progress}%` }"
          ></div>
          <div
            class="absolute top-1/2 -mt-1.5 w-3 h-3 bg-white rounded-full shadow transition-transform scale-0 group-hover:scale-100 pointer-events-none"
            :style="{ left: `calc(${progress}% - 6px)` }"
          ></div>
        </div>
      </div>

      <div class="flex items-center justify-between gap-3">
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
      </div>
    </div>
  </div>
</template>
