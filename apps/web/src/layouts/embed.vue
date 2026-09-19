<script setup lang="ts">
/**
 * Chrome-free shell for the embeddable editor. The host page owns the
 * surrounding UI, so this layout contributes nothing but a full-bleed root.
 */
import 'splitpanes/dist/splitpanes.css';
import { useEditorHotkeys } from '~/composables/editor/useEditorHotkeys';

// The default layout registers these too; without them here the embedded
// editor answered no shortcut at all.
useEditorHotkeys();
</script>

<template>
  <div class="h-dvh w-full overflow-hidden bg-ui-bg">
    <slot />
  </div>
</template>
