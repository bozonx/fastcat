<script setup lang="ts">
import MobileTimelineDrawer from './MobileTimelineDrawer.vue';
import MobileDrawerToolbar from './MobileDrawerToolbar.vue';
import { useDrawerToolbarOrientation } from '~/composables/timeline/useDrawerToolbarOrientation';
import { useCloseModel } from '~/composables/ui/useCloseModel';

interface Props {
  isOpen: boolean;
}

const props = defineProps<Props>();

/** Landscape uses a side drawer, so the toolbar becomes a vertical rail. */
const { toolbarOrientation } = useDrawerToolbarOrientation();

const activeSnapPoint = defineModel<string | number | null>('activeSnapPoint', { default: null });

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const isOpenLocal = useCloseModel(
  () => props.isOpen,
  () => emit('close'),
);
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
        :class="
          toolbarOrientation === 'vertical'
            ? 'border-r border-ui-border'
            : 'border-b border-ui-border'
        "
      >
        <slot name="toolbar" />
      </MobileDrawerToolbar>
    </template>

    <slot />
  </MobileTimelineDrawer>
</template>
