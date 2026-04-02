<script setup lang="ts">
/* 
  Embedded layout for SDK usage.
  Does NOT call workspaceStore.init() automatically to avoid IndexedDB conflicts 
  and ensure pure ephemeral mode.
*/
</script>

<template>
  <div class="embedded-layout h-full w-full bg-black text-white overflow-hidden">
    <slot />
  </div>
</template>

<style scoped>
.embedded-layout {
  position: fixed;
  inset: 0;
}
</style>
