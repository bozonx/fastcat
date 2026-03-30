<script setup lang="ts">
import { computed, ref, watch } from 'vue';

interface Props {
  /** Height of the drawer in toolbar (collapsed) mode */
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

const SNAP_FULL = 0.88;
const snapPoints = computed(() => [props.toolbarSnapHeight, SNAP_FULL]);

/**
 * Tracks the current snap point.
 * null = uncontrolled (vaul opens at first snap point by default).
 * Setting to a snap point value triggers programmatic snap.
 */
const activeSnapPoint = ref<string | number | null>(null);
const isExpanded = computed(() => activeSnapPoint.value === SNAP_FULL);

watch(isOpen, (val) => {
  if (!val) {
    // Return to uncontrolled so next open starts at toolbar snap
    activeSnapPoint.value = null;
  }
});

function onHandleTap() {
  if (isExpanded.value) {
    isOpen.value = false;
  } else {
    // Programmatic expand: controlled snap to full mode
    activeSnapPoint.value = SNAP_FULL;
  }
}

function onSnapPointChange(val: string | number) {
  activeSnapPoint.value = val;
}

function onDrawerUpdateOpen(val: boolean) {
  isOpen.value = val;
}
</script>

<template>
  <UDrawer
    :open="isOpen"
    :snap-points="snapPoints"
    :active-snap-point="activeSnapPoint ?? undefined"
    direction="bottom"
    :modal="isExpanded"
    :overlay="isExpanded"
    :dismissible="true"
    @update:open="onDrawerUpdateOpen"
    @update:active-snap-point="onSnapPointChange"
  >
    <template #content>
      <div
        class="flex flex-col border-t border-slate-800/80 bg-slate-900/95 backdrop-blur-2xl ring-1 ring-white/5 rounded-t-2xl"
      >
        <!-- Tappable drag handle -->
        <div
          class="shrink-0 flex justify-center pt-2.5 pb-1 touch-none select-none cursor-pointer"
          @click.stop="onHandleTap"
        >
          <div class="w-10 h-1 rounded-full bg-slate-700/70" />
        </div>

        <!-- Toolbar row: always visible in both modes -->
        <div class="shrink-0">
          <slot name="toolbar" />
        </div>

        <!-- Name / header info: only in expanded mode -->
        <template v-if="isExpanded">
          <div v-if="$slots.header" class="shrink-0 px-4 pt-3 pb-2">
            <slot name="header" />
          </div>

          <div class="mx-4 border-t border-slate-800/60" />

          <!-- Scrollable full content -->
          <div class="flex-1 overflow-y-auto pb-safe custom-scrollbar">
            <slot />
          </div>
        </template>
      </div>
    </template>
  </UDrawer>
</template>

<style scoped>
.pb-safe {
  padding-bottom: env(safe-area-inset-bottom, 24px);
}

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
