<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  availableColors: string[];
}>();

const selectedColors = defineModel<Set<string>>({ required: true });

function isLightColor(hex: string): boolean {
  const sanitized = hex.replace('#', '');
  const r = parseInt(sanitized.substring(0, 2), 16);
  const g = parseInt(sanitized.substring(2, 4), 16);
  const b = parseInt(sanitized.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6;
}

function toggleColor(color: string) {
  const next = new Set(selectedColors.value);
  if (next.has(color)) {
    next.delete(color);
  } else {
    next.add(color);
  }
  selectedColors.value = next;
}

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
  <div class="flex items-center gap-2">
    <div class="flex items-center gap-1.5">
      <button
        v-for="color in availableColors"
        :key="color"
        type="button"
        class="w-4 h-4 rounded-full border border-ui-border transition-all hover:scale-110 relative cursor-pointer"
        :class="{
          'opacity-100 ring-2 ring-primary-500 ring-offset-1 ring-offset-ui-bg-elevated scale-110 z-10':
            selectedColors.has(color),
          'opacity-40 hover:opacity-75': !selectedColors.has(color),
        }"
        :style="{ backgroundColor: color }"
        @click="toggleColor(color)"
      >
        <span
          v-if="selectedColors.has(color)"
          class="absolute inset-0 flex items-center justify-center text-[9px] font-bold leading-none select-none"
          :class="isLightColor(color) ? 'text-black' : 'text-white'"
        >
          ✓
        </span>
      </button>
    </div>
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
