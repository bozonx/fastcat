<script setup lang="ts">
/**
 * Unified Accordion Component
 *
 * Provides a consistent toggleable section with a large clickable header,
 * title, summary, and content slot.
 */

interface Props {
  /** Title shown when expanded */
  title?: string;
  /** Summary shown when collapsed */
  summary?: string;
  /** Initial expansion state if not using v-model:open */
  defaultOpen?: boolean;
  /** Nuxt UI icon name for the toggle indicator */
  icon?: string;
}

const props = withDefaults(defineProps<Props>(), {
  title: '',
  summary: '',
  defaultOpen: false,
  icon: 'i-heroicons-chevron-right-20-solid',
});

const isOpen = defineModel<boolean>('open');
const localOpen = ref(props.defaultOpen);

const isCurrentlyOpen = computed({
  get: () => (isOpen.value !== undefined ? isOpen.value : localOpen.value),
  set: (value) => {
    if (isOpen.value !== undefined) {
      isOpen.value = value;
    } else {
      localOpen.value = value;
    }
  },
});

function toggle() {
  isCurrentlyOpen.value = !isCurrentlyOpen.value;
}
</script>

<template>
  <div class="flex flex-col w-full">
    <button
      type="button"
      class="w-full flex justify-between items-center px-4 py-4 -mx-4 rounded-lg hover:bg-ui-bg-hover transition-all duration-200 group text-left select-none relative focus-visible:ring-2 focus-visible:ring-primary-500 outline-none"
      @click="toggle"
    >
      <div class="flex flex-col gap-0.5 min-w-0 pr-4">
        <h3
          v-if="title"
          v-show="isCurrentlyOpen"
          class="text-lg font-semibold text-ui-text"
        >
          {{ title }}
        </h3>
        <span
          v-if="summary || title"
          v-show="!isCurrentlyOpen"
          class="text-base text-ui-text-muted font-normal truncate"
        >
          {{ summary || title }}
        </span>
      </div>

      <UIcon
        :name="icon"
        class="w-5 h-5 text-ui-text-muted group-hover:text-ui-text transition-transform duration-200 shrink-0"
        :class="{ 'rotate-90': isCurrentlyOpen }"
      />
    </button>

    <div
      v-show="isCurrentlyOpen"
      class="w-full overflow-hidden animate-in fade-in slide-in-from-top-1 duration-200 pt-2"
    >
      <div class="pb-4">
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference "tailwindcss";
</style>
