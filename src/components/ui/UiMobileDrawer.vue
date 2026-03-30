<script setup lang="ts">
import { computed } from 'vue';
import { useWindowSize } from '@vueuse/core';

interface Props {
  /** Title of the drawer */
  title?: string;
  /** Optional description text below the title */
  description?: string;
  /** Snap points for the drawer (mostly for bottom direction) */
  snapPoints?: number[];
  /** Whether to scale the background when the drawer is open (iOS-style) */
  shouldScaleBackground?: boolean;
  /** Whether the drawer can be dismissed by clicking outside or swiping */
  dismissible?: boolean;
  /** Custom direction override, otherwise auto-detected by orientation */
  direction?: 'bottom' | 'top' | 'left' | 'right';
  /** Custom UI classes for the container */
  ui?: {
    container?: string;
    body?: string;
    header?: string;
    footer?: string;
  };
}

const props = withDefaults(defineProps<Props>(), {
  title: undefined,
  description: undefined,
  snapPoints: undefined,
  shouldScaleBackground: false,
  dismissible: true,
  direction: undefined,
  ui: () => ({}),
});

const isOpen = defineModel<boolean>('open', { default: false });

const { width, height } = useWindowSize();
const isLandscape = computed(() => width.value > height.value);

/**
 * Auto-detect direction based on orientation if not explicitly provided.
 * Mobile best practice: side for landscape, bottom for portrait.
 */
const effectiveDirection = computed(() => {
  if (props.direction) return props.direction;
  return isLandscape.value ? 'right' : 'bottom';
});

/** Responsive container logic */
const containerClasses = computed(() => {
  const base = 'flex flex-col relative overflow-hidden shadow-2xl transition-all duration-300';
  if (effectiveDirection.value === 'right' || effectiveDirection.value === 'left') {
    return `${base} max-h-dvh h-screen w-[50vw] sm:w-[40vw] ml-auto border-l border-ui-border bg-ui-bg-elevated/95 backdrop-blur-xl ${props.ui.container || ''}`;
  }
  return `${base} max-h-[85dvh] w-full border-t border-ui-border bg-ui-bg-elevated/95 backdrop-blur-xl rounded-t-[var(--radius-ui-xl)] ${props.ui.container || ''}`;
});
</script>

<template>
  <UDrawer
    v-model:open="isOpen"
    :direction="effectiveDirection"
    :title="props.title"
    :description="props.description"
    :snap-points="props.snapPoints"
    :dismissible="props.dismissible"
    :should-scale-background="props.shouldScaleBackground"
  >
    <template #content>
      <div :class="containerClasses">
        <!-- Visual handle for bottom sheets -->
        <div
          v-if="effectiveDirection === 'bottom'"
          class="shrink-0 flex justify-center py-2 relative z-10"
        >
          <div class="w-12 h-1.5 rounded-full bg-slate-700/50"></div>
        </div>

        <!-- Header -->
        <div
          v-if="props.title || $slots.header"
          class="shrink-0 pt-4 pb-3 px-5 header-stack"
          :class="props.ui.header"
        >
          <slot name="header">
            <h3 v-if="props.title" class="text-base font-bold text-ui-text leading-tight truncate">
              {{ props.title }}
            </h3>
            <p v-if="props.description" class="mt-1 text-xs text-ui-text-muted line-clamp-2">
              {{ props.description }}
            </p>
          </slot>
        </div>

        <!-- Main Body -->
        <div class="flex-1 overflow-y-auto pb-safe custom-scrollbar" :class="props.ui.body">
          <slot />
        </div>

        <!-- Footer -->
        <div
          v-if="$slots.footer"
          class="shrink-0 px-5 py-4 border-t border-ui-border/50"
          :class="props.ui.footer"
        >
          <slot name="footer" />
        </div>
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

.header-stack {
  mask-image: linear-gradient(to bottom, black calc(100% - 10px), transparent);
}
</style>
