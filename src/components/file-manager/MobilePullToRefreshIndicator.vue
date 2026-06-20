<script setup lang="ts">
defineProps<{
  isPulling: boolean;
  isRefreshing: boolean;
  pullDistance: number;
}>();
</script>

<template>
  <div
    v-if="isPulling || isRefreshing"
    class="absolute top-0 left-0 right-0 flex items-center justify-center z-10 pointer-events-none"
    :class="{ 'transition-all duration-300 ease-out': !isPulling }"
    :style="{
      transform: `translateY(${-48 + pullDistance}px)`,
      opacity: Math.min(1, pullDistance / 48),
    }"
  >
    <div
      class="bg-ui-bg-elevated rounded-full w-10 h-10 flex items-center justify-center shadow-lg border border-ui-border"
    >
      <Icon
        :name="isRefreshing ? 'lucide:loader-2' : 'lucide:arrow-down'"
        class="w-5 h-5 text-ui-text"
        :class="{ 'animate-spin': isRefreshing }"
      />
    </div>
  </div>
</template>
