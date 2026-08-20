<script setup lang="ts">
import UiModal from '~/components/ui/UiModal.vue';
import UiMobileDrawer from '~/components/ui/UiMobileDrawer.vue';
import { useMobileLayout } from '~/composables/useMobileLayout';

/**
 * Adaptive dialog primitive.
 *
 * On the desktop layout it renders the centered {@link UiModal}. On the mobile
 * layout (`/m/*`) it renders {@link UiMobileDrawer} as a bottom sheet, so simple
 * confirm / rename / create prompts sit in the thumb zone and ride above the
 * on-screen keyboard instead of popping in the middle of the screen (and no
 * longer "jump" to the center when opened from within another mobile sheet).
 *
 * Both branches expose the same title / body (default slot) / footer contract,
 * so callers stay identical across layouts.
 */
interface Props {
  title?: string;
  description?: string;
  /** Prevent dismissal via backdrop / ESC / swipe. */
  preventClose?: boolean;
  /** Passed straight through to {@link UiModal} (ignored on the drawer branch). */
  ui?: Record<string, unknown>;
}

const props = withDefaults(defineProps<Props>(), {
  title: undefined,
  description: undefined,
  preventClose: false,
  ui: () => ({}),
});

const isOpen = defineModel<boolean>('open', { required: true });

const emit = defineEmits<{
  (e: 'after:enter'): void;
  (e: 'close'): void;
}>();

const { isMobileLayout } = useMobileLayout();
</script>

<template>
  <UiMobileDrawer
    v-if="isMobileLayout"
    v-model:open="isOpen"
    :title="props.title"
    :description="props.description"
    :dismissible="!props.preventClose"
    @close="emit('close')"
  >
    <div class="px-5 py-4">
      <slot />
    </div>
    <template v-if="$slots.footer" #footer>
      <div class="flex justify-end gap-2 w-full">
        <slot name="footer" />
      </div>
    </template>
  </UiMobileDrawer>

  <UiModal
    v-else
    v-model:open="isOpen"
    :title="props.title"
    :description="props.description"
    :prevent-close="props.preventClose"
    :ui="props.ui"
    @close="emit('close')"
    @after:enter="emit('after:enter')"
  >
    <slot />
    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </UiModal>
</template>
