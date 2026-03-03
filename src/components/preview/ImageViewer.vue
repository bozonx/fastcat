<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useImagePanZoom } from '~/composables/preview/useImagePanZoom';

const props = defineProps<{
  src: string;
  alt?: string;
  isModal?: boolean;
}>();

const emit = defineEmits<{
  'open-modal': [];
  'close-modal': [];
}>();

const containerRef = ref<HTMLElement | null>(null);

const {
  scale,
  translateX,
  translateY,
  reset,
  onWheel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onCustomZoom,
} = useImagePanZoom(containerRef);

const imageStyle = computed(() => ({
  transform: `translate(${translateX.value}px, ${translateY.value}px) scale(${scale.value})`,
  transformOrigin: 'center',
  cursor: props.isModal ? 'default' : 'pointer',
}));

const contextMenuItems = computed(() => [
  [
    {
      label: 'Reset Zoom & Pan',
      icon: 'i-heroicons-arrow-path',
      onSelect: () => reset(),
      click: () => reset(),
    },
  ],
]);

function onClick(e: MouseEvent) {
  if (e.button !== 0) return;
  if (props.isModal) {
    emit('close-modal');
  } else {
    emit('open-modal');
  }
}

onMounted(() => {
  window.addEventListener('gran-zoom', ((e: CustomEvent<{ dir: number; target?: string }>) => {
    if (
      e.detail?.target === 'preview' ||
      document.activeElement?.closest('.image-viewer-container')
    ) {
      onCustomZoom(e);
    }
  }) as EventListener);
  window.addEventListener('gran-zoom-reset', ((e: CustomEvent<{ target?: string }>) => {
    if (
      e.detail?.target === 'preview' ||
      document.activeElement?.closest('.image-viewer-container')
    ) {
      reset();
    }
  }) as EventListener);
});

onUnmounted(() => {
  window.removeEventListener('gran-zoom', onCustomZoom as EventListener);
  window.removeEventListener('gran-zoom-reset', reset as EventListener);
});
</script>

<template>
  <UContextMenu :items="contextMenuItems" class="w-full h-full">
    <div
      ref="containerRef"
      class="image-viewer-container flex items-center justify-center w-full h-full bg-[#1a1a1a] overflow-hidden p-4 relative select-none outline-none"
      tabindex="-1"
      @wheel="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerUp"
      @click="onClick"
    >
      <img
        :src="props.src"
        :alt="props.alt || 'Image preview'"
        class="max-w-full max-h-full block checkerboard-bg transition-transform duration-75"
        :style="imageStyle"
        draggable="false"
      />
    </div>
  </UContextMenu>
</template>

<style scoped>
.checkerboard-bg {
  background-color: transparent;
  background-image:
    linear-gradient(45deg, rgba(255, 255, 255, 0.15) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(255, 255, 255, 0.15) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(255, 255, 255, 0.15) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(255, 255, 255, 0.15) 75%);
  background-size: 20px 20px;
  background-position:
    0 0,
    0 10px,
    10px -10px,
    -10px 0px;
  background-repeat: repeat;
}
</style>
