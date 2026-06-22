<script setup lang="ts">
import UiFormSectionHeader from '~/components/ui/UiFormSectionHeader.vue';

const props = defineProps<{
  title?: string;
  hasToggle?: boolean;
  showReset?: boolean;
  onReset?: () => void;
}>();

const isEnabled = defineModel<boolean>('enabled', { default: true });
</script>

<template>
  <div class="space-y-1 bg-ui-bg-elevated p-2 rounded border border-ui-border w-full">
    <UiFormSectionHeader
      v-if="
        props.title ||
        $slots['header-actions'] ||
        props.hasToggle ||
        (props.showReset && props.onReset)
      "
      :title="props.title ?? ''"
      class="border-b border-ui-border pb-1 mt-0! mb-1!"
    >
      <div class="flex items-center gap-2">
        <slot name="header-actions" />
        <button
          v-if="props.showReset && props.onReset"
          class="flex items-center gap-1 text-2xs text-ui-text-muted hover:text-ui-text disabled:opacity-50"
          :title="$t('common.actions.reset')"
          :disabled="!isEnabled"
          @click="props.onReset"
        >
          <UIcon name="i-heroicons-arrow-path" class="w-3.5 h-3.5 block" />
        </button>
        <USwitch
          v-if="props.hasToggle"
          v-model="isEnabled"
          size="xs"
          color="error"
          class="scale-75 origin-right"
        />
      </div>
    </UiFormSectionHeader>
    <slot />
  </div>
</template>
