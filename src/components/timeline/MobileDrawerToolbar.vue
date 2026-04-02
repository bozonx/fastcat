<template>
  <div data-vaul-no-drag class="overflow-x-auto no-scrollbar">
    <div class="flex items-center gap-1 px-2 py-1.5 w-max min-w-full">
      <slot />
    </div>
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
