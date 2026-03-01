<script setup lang="ts">
const colorMode = useColorMode();

// TODO: Hardcoded to dark mode for now. Remove this when adding support for other themes.
if (colorMode) {
  colorMode.preference = 'dark';
}

useHead({
  htmlAttrs: {
    class: 'dark',
  },
});
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
