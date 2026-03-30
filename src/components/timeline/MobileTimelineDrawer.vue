<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useWindowSize } from '@vueuse/core';

interface Props {
  /** Height of the drawer in toolbar (collapsed) mode — portrait only */
  toolbarSnapHeight?: string;
}

const props = withDefaults(defineProps<Props>(), {
  toolbarSnapHeight: '96px',
});

defineSlots<{
  toolbar(): unknown;
  header?(): unknown;
  default(): unknown;
}>();

const isOpen = defineModel<boolean>('open', { default: false });

const { width, height } = useWindowSize();
const isLandscape = computed(() => width.value > height.value);

const SNAP_FULL = 0.88;

/** Snap points only in portrait; landscape uses a full side panel without snapping */
const snapPoints = computed(() =>
  isLandscape.value ? undefined : [props.toolbarSnapHeight, SNAP_FULL],
);

/**
 * null = uncontrolled (vaul opens at first snap point naturally).
 * Setting to SNAP_FULL triggers programmatic expansion.
 */
const activeSnapPoint = ref<string | number | null>(null);

const isExpanded = computed(() => {
  if (isLandscape.value) return true;
  return activeSnapPoint.value === SNAP_FULL;
});

/**
 * Portrait container fills the snap height with overflow-hidden so that content
 * below the toolbar is clipped in toolbar mode and revealed in full mode.
 * Landscape container fills the full side panel.
 */
const containerClass = computed(() => {
  const base = 'h-full flex flex-col overflow-hidden bg-slate-900/95 backdrop-blur-2xl ring-1 ring-white/5';
  if (isLandscape.value) {
    return `${base} w-[50vw] sm:w-[40vw] ml-auto border-l border-slate-800/80 relative`;
  }
  return `${base} border-t border-slate-800/80 rounded-t-2xl`;
});

watch(isOpen, (val) => {
  if (!val) activeSnapPoint.value = null;
});

watch(isLandscape, () => {
  activeSnapPoint.value = null;
});

function onHandleTap() {
  if (isExpanded.value || isLandscape.value) {
    isOpen.value = false;
  } else {
    activeSnapPoint.value = SNAP_FULL;
  }
}

function onSnapPointChange(val: string | number) {
  activeSnapPoint.value = val;
}
</script>

<template>
  <UDrawer
    :open="isOpen"
    :snap-points="snapPoints"
    :active-snap-point="activeSnapPoint ?? undefined"
    :direction="isLandscape ? 'right' : 'bottom'"
    :handle="false"
    :modal="isExpanded"
    :overlay="isExpanded"
    :dismissible="true"
    @update:open="(val) => (isOpen = val)"
    @update:active-snap-point="onSnapPointChange"
  >
    <template #content>
      <!--
        Content is always fully rendered.
        Portrait toolbar mode: vaul sets DrawerContent to toolbar snap height;
        h-full + overflow-hidden clips everything below the toolbar.
        Portrait full / landscape: entire panel is visible and scrollable.
      -->
      <div :class="containerClass">
        <!-- Portrait drag handle (tap to expand / close) -->
        <div
          v-if="!isLandscape"
          class="shrink-0 flex justify-center py-2.5 cursor-pointer touch-none select-none"
          @click.stop="onHandleTap"
        >
          <div class="w-10 h-1 rounded-full bg-slate-700/60" />
        </div>

        <!-- Toolbar: visible in all modes -->
        <div class="shrink-0">
          <slot name="toolbar" />
        </div>

        <!-- Content below is clipped by overflow-hidden in portrait toolbar mode -->

        <!-- Header: clip / track name shown only in expanded state -->
        <div
          v-if="$slots.header"
          class="shrink-0 px-4 pt-3 pb-2 border-t border-slate-800/60"
        >
          <slot name="header" />
        </div>

        <!-- Scrollable full properties -->
        <div
          class="flex-1 min-h-0 overflow-y-auto custom-scrollbar"
          style="padding-bottom: env(safe-area-inset-bottom, 24px)"
        >
          <slot />
        </div>

        <!-- Landscape: vertical handle pill on the left edge, tap to close -->
        <div
          v-if="isLandscape"
          class="absolute left-0 top-0 bottom-0 w-5 flex items-center justify-center cursor-pointer"
          @click.stop="onHandleTap"
        >
          <div class="w-1 h-12 rounded-full bg-slate-700/60" />
        </div>
      </div>
    </template>
  </UDrawer>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: #334155;
  border-radius: 10px;
}
</style>
