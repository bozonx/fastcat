<script setup lang="ts">
import { computed } from 'vue';
import { useWindowSize } from '@vueuse/core';
import MobileTimelineDrawer from './MobileTimelineDrawer.vue';
import MobileDrawerToolbar from './MobileDrawerToolbar.vue';

interface Props {
  isOpen: boolean;
}

const props = defineProps<Props>();

const { width, height } = useWindowSize();
/** Landscape uses a side drawer, so the toolbar becomes a vertical rail. */
const toolbarOrientation = computed(() => (width.value > height.value ? 'vertical' : 'horizontal'));

const activeSnapPoint = defineModel<string | number | null>('activeSnapPoint', { default: null });

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const isOpenLocal = computed({
  get: () => props.isOpen,
  set: (val) => {
    if (!val) emit('close');
  },
});
</script>

<template>
  <MobileTimelineDrawer
    v-model:open="isOpenLocal"
    v-model:active-snap-point="activeSnapPoint"
    with-toolbar-snap
  >
    <template #toolbar>
      <MobileDrawerToolbar
        :orientation="toolbarOrientation"
        :class="toolbarOrientation === 'vertical' ? 'border-r border-ui-border' : 'border-b border-ui-border'"
      >
        <slot name="toolbar" />
      </MobileDrawerToolbar>
    </template>

    <slot />
  </MobileTimelineDrawer>
</template>
