<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useWindowSize } from '@vueuse/core';
import { useTimelineSettingsStore } from '~/stores/timeline-settings.store';

interface Props {
  /** Snap height showing only the toolbar (portrait mode) */
  toolbarSnapHeight?: string;
  /** Force specific direction in landscape (overrides user preference) */
  forceLandscapeDirection?: 'bottom' | 'right';
}

const props = withDefaults(defineProps<Props>(), {
  toolbarSnapHeight: '116px',
  forceLandscapeDirection: undefined,
});

defineSlots<{
  toolbar(): unknown;
  header?(): unknown;
  default(): unknown;
}>();

const isOpen = defineModel<boolean>('open', { default: false });

const settingsStore = useTimelineSettingsStore();
const { width, height } = useWindowSize();
const isLandscape = computed(() => width.value > height.value);

const SNAP_FULL_PORTRAIT = 0.92;
const SNAP_FULL_LANDSCAPE = 0.88;

const effectiveDirection = computed<'bottom' | 'right'>(() => {
  if (!isLandscape.value) return 'bottom';
  if (props.forceLandscapeDirection) return props.forceLandscapeDirection;
  return settingsStore.landscapeDrawerPosition;
});

const isRightMode = computed(() => effectiveDirection.value === 'right');

const snapFull = computed(() =>
  isLandscape.value && effectiveDirection.value === 'bottom'
    ? SNAP_FULL_LANDSCAPE
    : SNAP_FULL_PORTRAIT,
);

const snapPoints = computed(() =>
  effectiveDirection.value === 'bottom'
    ? [props.toolbarSnapHeight, snapFull.value]
    : undefined,
);

/**
 * null = uncontrolled — vaul opens at the first snap point naturally.
 * Setting to snapFull triggers a programmatic snap to full mode.
 */
const activeSnapPoint = ref<string | number | null>(null);

const isExpanded = computed(() => {
  if (isRightMode.value) return true;
  return activeSnapPoint.value === snapFull.value;
});

const showPositionToggle = computed(
  () => isLandscape.value && !props.forceLandscapeDirection,
);

const containerClass = computed(() => {
  const base =
    'h-full flex flex-col overflow-hidden bg-slate-900/95 backdrop-blur-2xl ring-1 ring-white/5';
  if (isRightMode.value) {
    return `${base} w-[50vw] sm:w-[40vw] border-l border-slate-800/80 relative`;
  }
  return `${base} border-t border-slate-800/80 rounded-t-2xl`;
});

watch(isOpen, (val) => {
  if (!val) activeSnapPoint.value = null;
});

watch([effectiveDirection, snapFull], () => {
  activeSnapPoint.value = null;
});

function onHandleTap() {
  if (isExpanded.value || isRightMode.value) {
    isOpen.value = false;
  } else {
    activeSnapPoint.value = snapFull.value;
  }
}

function onSnapPointChange(val: string | number) {
  activeSnapPoint.value = val;
}

// --- Backdrop: tap closes, swipe-down collapses to toolbar ---

const bdStartY = ref(0);
const bdStartX = ref(0);
const bdDy = ref(0);
const bdDx = ref(0);

const backdropInteractive = computed(
  () => isOpen.value && isExpanded.value && !isRightMode.value,
);

function onBackdropTouchStart(e: TouchEvent) {
  const t = e.touches[0];
  if (!t) return;
  bdStartY.value = t.clientY;
  bdStartX.value = t.clientX;
  bdDy.value = 0;
  bdDx.value = 0;
}

function onBackdropTouchMove(e: TouchEvent) {
  const t = e.touches[0];
  if (!t) return;
  bdDy.value = t.clientY - bdStartY.value;
  bdDx.value = t.clientX - bdStartX.value;
}

function onBackdropTouchEnd(e: TouchEvent) {
  e.preventDefault();
  const dy = bdDy.value;
  const adx = Math.abs(bdDx.value);

  if (Math.abs(dy) < 10 && adx < 10) {
    isOpen.value = false;
    return;
  }

  if (dy > 50 && dy > adx * 1.5) {
    activeSnapPoint.value = props.toolbarSnapHeight;
    return;
  }
}

function onBackdropClick() {
  isOpen.value = false;
}

function toggleLandscapePosition() {
  settingsStore.landscapeDrawerPosition =
    settingsStore.landscapeDrawerPosition === 'right' ? 'bottom' : 'right';
}
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 bg-black/55 transition-opacity duration-200"
      :class="[
        isOpen && isExpanded ? 'opacity-100' : 'opacity-0',
        backdropInteractive ? 'pointer-events-auto' : 'pointer-events-none',
      ]"
      :style="{ touchAction: backdropInteractive ? 'none' : 'auto' }"
      @touchstart.passive="onBackdropTouchStart"
      @touchmove.passive="onBackdropTouchMove"
      @touchend="onBackdropTouchEnd"
      @click="onBackdropClick"
    />
  </Teleport>

  <UDrawer
    :key="effectiveDirection"
    :open="isOpen"
    :snap-points="snapPoints"
    :active-snap-point="activeSnapPoint ?? undefined"
    :direction="effectiveDirection"
    :handle="false"
    :modal="false"
    :overlay="false"
    :dismissible="true"
    @update:open="(val: boolean) => (isOpen = val)"
    @update:active-snap-point="onSnapPointChange"
  >
    <template #content>
      <div :class="containerClass">
        <!-- Bottom mode: drag handle + landscape position toggle -->
        <div
          v-if="!isRightMode"
          class="shrink-0 flex items-center justify-center py-2 cursor-pointer touch-none select-none relative"
          @click.stop="onHandleTap"
        >
          <div class="w-10 h-1 rounded-full bg-slate-700/60" />
          <button
            v-if="showPositionToggle"
            class="absolute right-3 p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 transition-colors"
            @click.stop="toggleLandscapePosition"
          >
            <UIcon name="lucide:panel-right" class="w-4 h-4" />
          </button>
        </div>

        <!-- Toolbar row -->
        <div class="shrink-0 pb-1">
          <slot name="toolbar" />
        </div>

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

        <!-- Right mode: left-edge handle + position toggle -->
        <div
          v-if="isRightMode"
          class="absolute left-0 top-0 bottom-0 w-6 flex flex-col items-center justify-center gap-4"
        >
          <button
            v-if="showPositionToggle"
            class="p-1 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 transition-colors"
            @click.stop="toggleLandscapePosition"
          >
            <UIcon name="lucide:panel-bottom" class="w-4 h-4" />
          </button>
          <div
            class="w-1 h-12 rounded-full bg-slate-700/60 cursor-pointer"
            @click.stop="onHandleTap"
          />
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
