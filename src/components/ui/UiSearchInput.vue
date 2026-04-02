<script setup lang="ts">
const modelValue = defineModel<string>({ default: '' });

const props = withDefaults(
  defineProps<{
    placeholder?: string;
    disabled?: boolean;
    isMobile?: boolean;
  }>(),
  {
    placeholder: undefined,
    disabled: false,
    isMobile: false,
  },
);

const { t } = useI18n();
</script>

<template>
  <UInput
    v-model="modelValue"
    :placeholder="placeholder ?? t('common.search', 'Search')"
    :disabled="disabled"
    class="w-full group"
    :class="{
      'h-12 transition-all duration-300': isMobile,
      'bg-zinc-900/40 border-white/5 focus-within:bg-zinc-900 focus-within:border-primary-500/30':
        isMobile,
    }"
    :ui="{
      base: [
        'bg-ui-bg-elevated/50 border-ui-border hover:border-ui-border-accent focus:border-primary-500/50 transition-all duration-200',
        isMobile ? 'h-full px-5 text-sm font-medium rounded-2xl!' : 'h-10 px-4 text-sm rounded-xl',
      ],
      leading: 'hidden',
      trailing: isMobile ? 'pe-4' : 'pe-3',
    }"
  >
    <template #trailing>
      <div class="flex items-center gap-2">
        <UButton
          v-if="modelValue"
          color="neutral"
          variant="link"
          icon="i-heroicons-x-mark-20-solid"
          :padded="false"
          class="text-ui-text-muted hover:text-ui-text transition-colors"
          @click="modelValue = ''"
        />
        <UIcon
          name="i-heroicons-magnifying-glass"
          class="w-4 h-4 text-ui-text-muted group-focus-within:text-primary-400 transition-colors"
        />
      </div>
    </template>
  </UInput>
</template>
