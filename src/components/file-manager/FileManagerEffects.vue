<script setup lang="ts">
const { t } = useI18n();
</script>

<template>
  <div class="flex-1 overflow-y-auto relative">
    <div class="flex flex-col items-center justify-center h-full text-ui-text-disabled px-4 text-center">
      <UIcon name="i-heroicons-sparkles" class="w-10 h-10 mb-3" />
      <p class="text-sm italic">
        {{ t('videoEditor.fileManager.tabs.effects', 'Effects') }}
        {{ t('common.noData', '(coming soon)') }}
      </p>
    </div>
  </div>
</template>
