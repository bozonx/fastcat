<script setup lang="ts">
import { computed, watch } from 'vue';
import { useWindowSize } from '@vueuse/core';
import UiMobileDrawer from '~/components/ui/UiMobileDrawer.vue';

interface Props {
  /** Snap height showing only the toolbar (portrait mode) */
  toolbarSnapHeight?: string;
  /** Enables an intermediate snap point that leaves only the toolbar visible */
  withToolbarSnap?: boolean;
  /** Initial drawer mode in portrait when toolbar snap is enabled */
  initialMode?: 'toolbar' | 'full';
  /** Show close button */
  showClose?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  toolbarSnapHeight: '116px',
  withToolbarSnap: false,
  initialMode: 'toolbar',
  showClose: false,
});

defineSlots<{
  toolbar(): unknown;
  header?(): unknown;
  default(): unknown;
}>();

const isOpen = defineModel<boolean>('open', { default: false });
const activeSnapPoint = defineModel<string | number | null>('activeSnapPoint', { default: null });

const { width, height } = useWindowSize();
const isLandscape = computed(() => width.value > height.value);

const SNAP_FULL_PORTRAIT = 0.92;
const effectiveDirection = computed<'bottom' | 'right'>(() =>
  isLandscape.value ? 'right' : 'bottom',
);

const snapFull = computed(() => SNAP_FULL_PORTRAIT);

const snapPoints = computed(() =>
  effectiveDirection.value === 'bottom'
    ? props.withToolbarSnap
      ? [props.toolbarSnapHeight, snapFull.value]
      : [snapFull.value]
    : undefined,
);

const initialSnapPoint = computed<string | number | null>(() => {
  const points = snapPoints.value;
  if (!points?.length) return null;
  if (!props.withToolbarSnap || isLandscape.value || props.initialMode === 'full') {
    return points[points.length - 1] as string | number;
  }
  return points[0] as string | number;
});

watch(
  [isOpen, snapPoints, initialSnapPoint],
  ([open, points, nextInitialSnapPoint]) => {
    if (!open || !points?.length) return;

    if (!points.includes(activeSnapPoint.value as string | number)) {
      activeSnapPoint.value = nextInitialSnapPoint;
    }
  },
  { immediate: true },
);
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
    </template>

    <template v-if="$slots.header" #header>
      <slot name="header" />
    </template>

    <slot />
  </UiMobileDrawer>
</template>
