<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useImagePanZoom } from '~/composables/preview/useImagePanZoom';
import { useUiStore } from '~/stores/ui.store';
import { useFocusStore, type PanelFocusId } from '~/stores/focus.store';
import { useWorkspaceStore } from '~/stores/workspace.store';

const { t } = useI18n();
const uiStore = useUiStore();
const focusStore = useFocusStore();
const workspaceStore = useWorkspaceStore();

const props = defineProps<{
  src: string;
  alt?: string;
  isModal?: boolean;
  focusPanelId?: string;
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
  isReady,
  reset,
  fitToContainer,
  onWheel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onAuxClick,
  onCustomZoom,
} = useImagePanZoom(containerRef);

const imageStyle = computed(() => ({
  transform: `translate(${translateX.value}px, ${translateY.value}px) scale(${scale.value})`,
  transformOrigin: 'center',
  cursor:
    workspaceStore.userSettings.mouse.monitor.leftDoubleClick === 'fullscreen'
      ? 'zoom-in'
      : 'default',
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
      onSelect: () => reset(),
      click: () => reset(),
    },
  ],
]);

function toggleModalFullscreen() {
  if (props.isModal) emit('close-modal');
  else emit('open-modal');
}

function applyViewerAction(action: string) {
  if (action === 'fullscreen') {
    toggleModalFullscreen();
  } else if (action === 'fit') {
    fitToContainer();
  } else if (action === 'reset_zoom' || action === 'reset_zoom_center') {
    reset();
  }
}

function onDblClick(e: MouseEvent) {
  if (e.button !== 0) return;
  applyViewerAction(workspaceStore.userSettings.mouse.monitor.leftDoubleClick);
}

function shouldHandlePreviewZoom() {
  if (props.isModal) return true;
  if (!props.focusPanelId) return focusStore.canUsePreviewHotkeys;
  return focusStore.isPanelFocused(props.focusPanelId as PanelFocusId);
}

watch(
  () => props.src,
  () => {
    fitToContainer();
  },
);

watch(
  () => uiStore.previewZoomTrigger,
  (trigger) => {
    if (!trigger.timestamp || !containerRef.value || !shouldHandlePreviewZoom()) return;

    onCustomZoom(
      new CustomEvent('fastcat-zoom', { detail: { dir: trigger.dir, target: 'preview' } }),
    );
  },
  { deep: true },
);

watch(
  () => uiStore.previewZoomResetTrigger,
  (timestamp) => {
    if (!timestamp || !containerRef.value || !shouldHandlePreviewZoom()) return;

    reset();
  },
);

watch(
  () => uiStore.previewZoomFitTrigger,
  (timestamp) => {
    if (!timestamp || !containerRef.value || !shouldHandlePreviewZoom()) return;

    fitToContainer();
  },
);

function onImageLoad() {
  fitToContainer();
}

onMounted(() => {
  fitToContainer();
});

onUnmounted(() => {});
</script>

<template>
  <UContextMenu
    :items="contextMenuItems"
    :modal="false"
    class="w-full h-full"
    :ui="{ content: 'z-[100000]' }"
  >
    <div
      ref="containerRef"
      class="image-viewer-container flex items-center justify-center w-full h-full bg-[#1a1a1a] overflow-hidden relative select-none outline-none"
      tabindex="-1"
      @wheel="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerUp"
      @auxclick="onAuxClick"
      @dblclick.prevent="onDblClick"
    >
      <img
        :src="props.src"
        :alt="props.alt || t('common.imagePreview')"
        class="max-w-full max-h-full block checkerboard-bg"
        :class="isReady ? 'opacity-100' : 'opacity-0'"
        :style="imageStyle"
        draggable="false"
        @load="onImageLoad"
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
