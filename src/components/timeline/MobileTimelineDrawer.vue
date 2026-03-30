<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useWindowSize } from '@vueuse/core';

interface Props {
  /** Snap height showing only the toolbar (portrait mode) */
  toolbarSnapHeight?: string;
}

const props = withDefaults(defineProps<Props>(), {
  toolbarSnapHeight: '116px',
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

const snapPoints = computed(() =>
  isLandscape.value ? undefined : [props.toolbarSnapHeight, SNAP_FULL],
);

/**
 * null = uncontrolled — vaul opens at the first snap point naturally.
 * Setting to SNAP_FULL triggers a programmatic snap to full mode.
 */
const activeSnapPoint = ref<string | number | null>(null);

const isExpanded = computed(() => {
  if (isLandscape.value) return true;
  return activeSnapPoint.value === SNAP_FULL;
});

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
  <!--
    Backdrop is mounted immediately (before the drawer portal) so its z-index:auto
    is below the drawer portal in DOM stacking order.
    pointer-events-none keeps the timeline fully interactive through it.
  -->
  <Teleport to="body">
    <div
      class="fixed inset-0 bg-black/55 pointer-events-none transition-opacity duration-200"
      :class="isOpen && isExpanded ? 'opacity-100' : 'opacity-0'"
    />
  </Teleport>

  <!--
    modal=false / overlay=false are NEVER changed — prevents Reka from
    remounting DrawerContent and replaying the open animation.
    The backdrop above provides visual dimming in full mode.
  -->
  <UDrawer
    :open="isOpen"
    :snap-points="snapPoints"
    :active-snap-point="activeSnapPoint ?? undefined"
    :direction="isLandscape ? 'right' : 'bottom'"
    :handle="false"
    :modal="false"
    :overlay="false"
    :dismissible="true"
    @update:open="(val) => (isOpen = val)"
    @update:active-snap-point="onSnapPointChange"
  >
    <template #content>
      <!--
        h-full fills the DrawerContent height (set by vaul to the snap value).
        overflow-hidden clips everything below the toolbar in toolbar mode.
        All content is always rendered — no v-if — so dragging is smooth.
      -->
      <div :class="containerClass">
        <!-- Portrait drag handle: tap to expand or close -->
        <div
          v-if="!isLandscape"
          class="shrink-0 flex justify-center py-2 cursor-pointer touch-none select-none"
          @click.stop="onHandleTap"
        >
          <div class="w-10 h-1 rounded-full bg-slate-700/60" />
        </div>

        <!-- Toolbar row: visible in toolbar mode and full mode -->
        <div class="shrink-0 pb-1">
          <slot name="toolbar" />
        </div>

        <!-- Everything below is hidden by overflow-hidden in toolbar mode -->

        <!-- Header: entity name/label -->
        <div
          v-if="$slots.header"
          class="shrink-0 px-4 pt-3 pb-2 border-t border-slate-800/60"
        >
          <slot name="header" />
        </div>

        <!-- Scrollable properties content -->
        <div
          class="flex-1 min-h-0 overflow-y-auto custom-scrollbar"
          style="padding-bottom: env(safe-area-inset-bottom, 24px)"
        >
          <slot />
        </div>

        <!-- Landscape: vertical pill handle on the left edge to close -->
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
