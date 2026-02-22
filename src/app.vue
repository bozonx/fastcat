<script setup lang="ts">
const colorMode = useColorMode();

// TODO: Hardcoded to dark mode for now. Remove this when adding support for other themes.
colorMode.preference = 'dark';

useHead({
  htmlAttrs: {
    class: 'dark',
  },
});
</script>

<template>
  <UApp>
    <NuxtPage />
  </UApp>
</template>
