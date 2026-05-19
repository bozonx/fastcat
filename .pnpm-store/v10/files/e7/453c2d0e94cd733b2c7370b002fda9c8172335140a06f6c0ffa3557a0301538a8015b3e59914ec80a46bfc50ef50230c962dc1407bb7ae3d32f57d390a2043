<script>

</script>

<script setup>
import { Icon as IconifyIcon } from "@iconify/vue";
defineProps({
  name: { type: null, required: true }
});
</script>

<template>
  <IconifyIcon v-if="typeof name === 'string'" :icon="name.replace(/^i-/, '')" />
  <component :is="name" v-else />
</template>
