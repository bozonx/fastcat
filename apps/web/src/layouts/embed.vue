<script setup lang="ts">
/**
 * Chrome-free shell for the embeddable editor. The host page owns the
 * surrounding UI, so this layout contributes nothing but a full-bleed root.
 */
import 'splitpanes/dist/splitpanes.css';
</script>

<template>
  <div class="h-dvh w-full overflow-hidden bg-ui-bg">
    <slot />
  </div>
</template>
