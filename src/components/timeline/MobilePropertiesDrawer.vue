<script setup lang="ts">
import MobileTimelineDrawer from './MobileTimelineDrawer.vue';
import MobileDrawerToolbar from './MobileDrawerToolbar.vue';
import { useDrawerToolbarOrientation } from '~/composables/timeline/useDrawerToolbarOrientation';
import { useMobileDrawerOpen } from '~/composables/ui/useMobileDrawerOpen';

interface Props {
  isOpen: boolean;
  showClose?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  showClose: true,
});

/** Landscape uses a side drawer, so the toolbar becomes a vertical rail. */
const { toolbarOrientation } = useDrawerToolbarOrientation();

const activeSnapPoint = defineModel<string | number | null>('activeSnapPoint', { default: null });

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const isOpenLocal = useMobileDrawerOpen(props, emit);
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
        :show-close="props.showClose"
        @close="emit('close')"
      >
        <slot name="toolbar" />
      </MobileDrawerToolbar>
    </template>

    <slot />
  </MobileTimelineDrawer>
</template>
