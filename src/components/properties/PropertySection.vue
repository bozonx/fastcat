<script setup lang="ts">
import UiFormSectionHeader from '~/components/ui/UiFormSectionHeader.vue';

const props = defineProps<{
  title?: string;
  hasToggle?: boolean;
}>();

const model = defineModel<boolean>('toggleValue');
</script>

<template>
  <div class="space-y-1 bg-ui-bg-elevated p-2 rounded border border-ui-border w-full">
    <UiFormSectionHeader
      v-if="props.title || $slots['header-actions'] || props.hasToggle"
      :title="props.title ?? ''"
      class="border-b border-ui-border pb-1 mt-0! mb-1!"
    >
      <div class="flex items-center gap-2">
        <slot name="header-actions" />
        <USwitch
          v-if="props.hasToggle"
          v-model="model"
          size="xs"
          color="red"
          checked-icon="i-heroicons-check-20-solid"
          unchecked-icon="i-heroicons-x-mark-20-solid"
        />
      </div>
    </UiFormSectionHeader>
    <div class="flex flex-col">
      <slot />
    </div>
  </div>
</template>
