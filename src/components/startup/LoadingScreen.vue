<script setup lang="ts">
const { t } = useI18n();
</script>

<template>
  <div class="flex flex-col items-center justify-center flex-1 bg-ui-bg">
    <UIcon name="i-heroicons-arrow-path" class="w-10 h-10 text-primary-500 shrink-0 animate-spin" />
    <span class="mt-4 text-ui-text-muted font-medium tracking-wide animate-pulse">
      {{ t('common.loading') }}
    </span>
  </div>
</template>
