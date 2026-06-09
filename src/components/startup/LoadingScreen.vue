<script setup lang="ts">
defineProps<{
  isAutoOpening?: boolean;
  projectName?: string | null;
}>();

defineEmits<{
  (e: 'cancel'): void;
}>();

const { t } = useI18n();
</script>

<template>
  <div
    class="flex flex-col items-center justify-center flex-1 bg-linear-to-br from-primary-950 via-ui-bg-elevated to-black p-6"
  >
    <div
      class="max-w-md w-full text-center space-y-6 bg-ui-bg-elevated/50 p-8 rounded-2xl backdrop-blur-sm border border-ui-border/50 shadow-2xl animate-fade-in"
    >
      <div
        class="mx-auto w-16 h-16 bg-primary-500/20 rounded-full flex items-center justify-center mb-6"
      >
        <UIcon name="i-heroicons-arrow-path" class="w-8 h-8 text-primary-400 animate-spin" />
      </div>

      <h3
        class="text-xl font-bold bg-clip-text text-transparent bg-linear-to-r from-primary-300 to-primary-200"
      >
        <template v-if="isAutoOpening && projectName">
          {{ t('fastcat.startup.loadingLastProject', { name: projectName }) }}
        </template>
        <template v-else>
          {{ t('common.loading') }}
        </template>
      </h3>

      <p v-if="isAutoOpening" class="text-ui-text-muted text-sm">
        {{ t('fastcat.startup.pleaseWait') }}
      </p>

      <UButton
        v-if="isAutoOpening"
        size="md"
        variant="soft"
        color="neutral"
        icon="i-heroicons-x-mark"
        class="w-full justify-center transition-all hover:scale-[1.02]"
        :label="t('fastcat.startup.cancelLoading')"
        @click="$emit('cancel')"
      />
    </div>
  </div>
</template>
