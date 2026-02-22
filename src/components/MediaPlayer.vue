<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';

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
  if (!mediaElement.value) return;
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

function seek(e: MouseEvent) {
  if (!mediaElement.value || duration.value === 0) return;
  const target = e.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const newProgress = Math.max(0, Math.min(1, clickX / rect.width));
  mediaElement.value.currentTime = newProgress * duration.value;
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
  <div class="flex flex-col w-full h-full">
    <!-- Media Element -->
    <div class="flex-1 flex items-center justify-center min-h-0 bg-black relative">
      <video
        v-if="type === 'video'"
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
      <audio
        v-else-if="type === 'audio'"
        ref="mediaElement"
        :src="src"
        class="hidden"
        @timeupdate="onTimeUpdate"
        @loadedmetadata="onLoadedMetadata"
        @play="onPlay"
        @pause="onPause"
        @ended="onPause"
      ></audio>
      <div
        v-if="type === 'audio'"
        class="flex flex-col items-center justify-center absolute inset-0 text-gray-400"
      >
        <UIcon name="i-heroicons-musical-note" class="w-20 h-20 mb-4 opacity-50" />
        <span class="text-sm">Audio Track</span>
      </div>
    </div>

    <!-- Controls -->
    <div class="flex flex-col px-4 py-2 border-t border-gray-700 bg-gray-900 shrink-0 gap-2">
      <!-- Scrubber -->
      <div class="h-2 bg-gray-700 rounded-full w-full cursor-pointer relative group" @click="seek">
        <div
          class="absolute top-0 left-0 h-full bg-primary-500 rounded-full"
          :style="{ width: `${progress}%` }"
        ></div>
        <div
          class="absolute top-1/2 -mt-1.5 w-3 h-3 bg-white rounded-full shadow transition-transform scale-0 group-hover:scale-100 cursor-grab"
          :style="{ left: `calc(${progress}% - 6px)` }"
        ></div>
      </div>

      <!-- Buttons -->
      <div class="flex items-center gap-3">
        <UButton
          size="sm"
          variant="solid"
          color="primary"
          :icon="isPlaying ? 'i-heroicons-pause' : 'i-heroicons-play'"
          @click="togglePlay"
        />
        <span class="text-xs text-gray-400 font-mono">
          {{ formatTime(currentTime) }} / {{ formatTime(duration) }}
        </span>
      </div>
    </div>
  </div>
</template>
