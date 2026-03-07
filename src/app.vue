<script setup lang="ts">
import RemoteFileExchangeModal from '~/components/file-manager/RemoteFileExchangeModal.vue';

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
    <RemoteFileExchangeModal />
  </UApp>
</template>

<style>
/* Global styles that might be needed in app.vue */
html,
body,
#__nuxt {
  height: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
}

body {
  background-color: var(--ui-bg);
  color: var(--ui-text);
}
</style>
