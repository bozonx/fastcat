<script setup lang="ts">
/**
 * Holds one editing session and renders whichever shell suits the container.
 *
 * Because the shells sit under a single root and every editing store is a
 * global singleton, switching between them keeps the timeline, media and
 * history intact — the layout changes, the session does not.
 */
import { ref, toRef } from 'vue';
import DesktopShell from '~/components/editor/DesktopShell.vue';
import MobileShell, { type MobileShellTab } from '~/components/editor/MobileShell.vue';
import {
  useContainerLayoutMode,
  type LayoutModePreference,
} from '~/composables/layout/useLayoutMode';

const props = withDefaults(
  defineProps<{
    /** `auto` decides once from the container's first measured size. */
    layout?: LayoutModePreference;
    mobileTabs?: MobileShellTab[];
    navMode?: 'routed' | 'embedded';
  }>(),
  {
    layout: 'auto',
    mobileTabs: () => ['files', 'edit', 'export', 'settings'],
    navMode: 'embedded',
  },
);

const containerRef = ref<HTMLElement | null>(null);
const { mode, isResolved, toggle } = useContainerLayoutMode(containerRef, toRef(props, 'layout'));

defineExpose({ mode, isResolved, toggle });
</script>

<template>
  <div
    ref="containerRef"
    class="h-full w-full min-h-0 min-w-0"
    :data-layout-mode="mode ?? 'pending'"
  >
    <DesktopShell v-if="mode === 'desktop'" />
    <MobileShell v-else-if="mode === 'mobile'" :tabs="mobileTabs" :nav-mode="navMode" />
  </div>
</template>
