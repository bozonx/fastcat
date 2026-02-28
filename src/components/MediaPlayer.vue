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
        <div class="relative flex flex-col items-center justify-center text-ui-text-muted px-6">
          <div
            class="w-32 h-32 rounded-2xl bg-ui-bg-elevated/60 border border-ui-border flex items-center justify-center"
          >
            <UIcon name="i-heroicons-musical-note" class="w-16 h-16 opacity-70" />
          </div>
          <div class="mt-4 text-xs uppercase tracking-wider opacity-70">
            {{ t('granVideoEditor.preview.audioTrack', 'Audio Track') }}
          </div>
        </div>
      </div>
    </div>

    <!-- Controls -->
    <div class="flex flex-col px-4 py-3 border-t border-ui-border bg-ui-bg-elevated shrink-0 gap-2">
      <div
        class="h-2 bg-ui-bg-accent rounded-full w-full cursor-pointer relative group"
        @click="seek"
      >
        <div
          class="absolute top-0 left-0 h-full bg-primary-500 rounded-full"
          :style="{ width: `${progress}%` }"
        ></div>
        <div
          class="absolute top-1/2 -mt-1.5 w-3 h-3 bg-white rounded-full shadow transition-transform scale-0 group-hover:scale-100 cursor-grab"
          :style="{ left: `calc(${progress}% - 6px)` }"
        ></div>
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
