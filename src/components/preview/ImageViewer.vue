<script setup lang="ts">
const props = defineProps<{
  src: string;
  alt?: string;
}>();
</script>

<template>
  <div class="flex items-center justify-center w-full h-full bg-[#1a1a1a] overflow-auto p-4">
    <div class="relative max-w-full max-h-full flex items-center justify-center shadow-lg">
      <div class="absolute inset-0 checkerboard-bg z-0 rounded-sm"></div>
      <img
        :src="props.src"
        :alt="props.alt || 'Image preview'"
        class="max-w-full max-h-full z-10 rounded-sm"
        style="display: block;"
      />
    </div>
  </div>
</template>

<style scoped>
.checkerboard-bg {
  background-color: transparent;
  background-image: linear-gradient(45deg, rgba(255, 255, 255, 0.15) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(255, 255, 255, 0.15) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(255, 255, 255, 0.15) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(255, 255, 255, 0.15) 75%);
  background-size: 20px 20px;
  background-position:
    0 0,
    0 10px,
    10px -10px,
    -10px 0px;
}
</style>
