<script setup lang="ts">
const colorMode = useColorMode();

/**
 * Handle initial color mode preference.
 * Defaults to dark but allows user to change it if we add a theme switcher later.
 */
if (colorMode.preference === 'system') {
  colorMode.preference = 'dark';
}
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>

<style>
/* Global styles that might be needed in app.vue */
html, body, #__nuxt {
  height: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
}

body {
  @apply bg-ui-bg text-ui-text;
}
</style>
