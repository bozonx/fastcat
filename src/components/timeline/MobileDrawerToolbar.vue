<template>
  <div class="flex items-center gap-1 px-2 py-1.5 overflow-x-auto no-scrollbar">
    <slot />
  </div>
</template>

<style scoped>
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
