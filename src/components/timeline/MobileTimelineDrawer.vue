<script setup lang="ts">
import { computed, ref } from 'vue';
import { useWindowSize } from '@vueuse/core';
import { useTimelineSettingsStore } from '~/stores/timeline-settings.store';
import UiMobileDrawer from '~/components/ui/UiMobileDrawer.vue';

interface Props {
  /** Snap height showing only the toolbar (portrait mode) */
  toolbarSnapHeight?: string;
  /** Force specific direction in landscape (overrides user preference) */
  forceLandscapeDirection?: 'bottom' | 'right';
  /** Show close button */
  showClose?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  toolbarSnapHeight: '116px',
  forceLandscapeDirection: undefined,
  showClose: false,
});

defineSlots<{
  toolbar(): unknown;
  header?(): unknown;
  default(): unknown;
}>();

const isOpen = defineModel<boolean>('open', { default: false });
const activeSnapPoint = defineModel<string | number | null>('activeSnapPoint', { default: null });

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
  effectiveDirection.value === 'bottom' ? [props.toolbarSnapHeight, snapFull.value] : undefined,
);

const showPositionToggle = computed(() => isLandscape.value && !props.forceLandscapeDirection);

function toggleLandscapePosition() {
  settingsStore.landscapeDrawerPosition =
    settingsStore.landscapeDrawerPosition === 'right' ? 'bottom' : 'right';
}
</script>

<template>
  <UiMobileDrawer
    v-model:open="isOpen"
    v-model:active-snap-point="activeSnapPoint"
    :direction="effectiveDirection"
    :snap-points="snapPoints"
    :modal="false"
    :overlay="false"
    :with-handle="true"
    :show-close="props.showClose"
    :ui="{
      toolbar: 'pb-1 relative',
    }"
  >
    <template #toolbar>
      <slot name="toolbar" />

      <!-- Landscape position toggle (Bottom mode) -->
      <button
        v-if="showPositionToggle && !isRightMode"
        class="absolute right-3 top-2 p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 transition-colors z-20"
        @click.stop="toggleLandscapePosition"
      >
        <UIcon name="lucide:panel-right" class="w-4 h-4" />
      </button>

      <!-- Landscape position toggle (Right mode) -->
      <button
        v-if="showPositionToggle && isRightMode"
        class="absolute left-1 top-1/2 -translate-y-10 p-1 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 transition-colors z-20"
        @click.stop="toggleLandscapePosition"
      >
        <UIcon name="lucide:panel-bottom" class="w-4 h-4" />
      </button>
    </template>

    <template v-if="$slots.header" #header>
      <slot name="header" />
    </template>

    <slot />
  </UiMobileDrawer>
</template>
