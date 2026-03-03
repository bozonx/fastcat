<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useImagePanZoom } from '~/composables/preview/useImagePanZoom';
import { useUiStore } from '~/stores/ui.store';
import { useFocusStore } from '~/stores/focus.store';

const { t } = useI18n();
const uiStore = useUiStore();
const focusStore = useFocusStore();

const props = defineProps<{
  src: string;
  alt?: string;
  isModal?: boolean;
}>();

const emit = defineEmits<{
  (e: 'open-modal'): void;
  (e: 'close-modal'): void;
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
      label: t('granVideoEditor.preview.resetZoom', 'Reset Zoom & Pan'),
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

watch(
  () => props.src,
  () => {
    reset();
  },
);

watch(
  () => uiStore.previewZoomTrigger,
  (trigger) => {
    if (!trigger.timestamp) return;
    if (!containerRef.value) return;

    if (
      focusStore.effectiveFocus === 'right' ||
      focusStore.effectiveFocus === 'left' ||
      document.activeElement?.closest('.image-viewer-container')
    ) {
      onCustomZoom(
        new CustomEvent('gran-zoom', { detail: { dir: trigger.dir, target: 'preview' } }),
      );
    }
  },
  { deep: true },
);

watch(
  () => uiStore.previewZoomResetTrigger,
  (timestamp) => {
    if (!timestamp) return;
    if (!containerRef.value) return;

    if (
      focusStore.effectiveFocus === 'right' ||
      focusStore.effectiveFocus === 'left' ||
      document.activeElement?.closest('.image-viewer-container')
    ) {
      reset();
    }
  },
);

onMounted(() => {});

onUnmounted(() => {});
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
