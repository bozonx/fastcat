<script setup lang="ts">
import { useFriendlyTimeAgo } from '~/composables/useFriendlyTimeAgo';

const props = withDefaults(
  defineProps<{
    date?: Date | number | string | null;
    fallback?: string;
  }>(),
  {
    date: null,
    fallback: '—',
  },
);

const friendlyTime = useFriendlyTimeAgo(() => props.date, props.fallback);
</script>

<template>
  <span>{{ friendlyTime }}</span>
</template>
