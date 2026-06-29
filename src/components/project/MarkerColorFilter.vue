<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  availableColors: string[];
  orientation?: 'horizontal' | 'vertical';
}>();

const selectedColors = defineModel<Set<string>>({ required: true });

const selectedColorList = computed({
  get: () => Array.from(selectedColors.value),
  set: (value: string | string[]) => {
    selectedColors.value = new Set(Array.isArray(value) ? value : [value]);
  },
});

const isAllSelected = computed(() => {
  return (
    props.availableColors.length > 0 &&
    props.availableColors.every((c) => selectedColors.value.has(c))
  );
});

function toggleAll() {
  if (isAllSelected.value) {
    selectedColors.value = new Set();
  } else {
    selectedColors.value = new Set(props.availableColors);
  }
}
</script>

<template>
  <div
    class="flex gap-2"
    :class="props.orientation === 'vertical' ? 'flex-col items-center' : 'items-center'"
  >
    <UiColorPicker
      v-model="selectedColorList"
      class="marker-color-filter"
      mode="custom"
      :colors="availableColors"
      multiple
      size="xs"
      :orientation="props.orientation === 'vertical' ? 'vertical' : 'horizontal'"
    />
    <UButton
      v-if="availableColors.length > 0"
      size="xs"
      variant="ghost"
      color="neutral"
      class="cursor-pointer"
      @click="toggleAll"
    >
      {{ $t('fastcat.marker.selectAll') }}
    </UButton>
  </div>
</template>
