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
    icon="i-heroicons-magnifying-glass"
    class="w-full"
    :class="{
      'h-12 rounded-2xl! transition-all duration-300': isMobile,
      'bg-slate-900/40 border-white/5 focus-within:bg-slate-900 focus-within:border-primary-500/30': isMobile,
    }"
    :ui="{
      base: isMobile ? 'h-full px-5 text-sm font-medium' : '',
      rounded: isMobile ? 'rounded-2xl' : 'rounded-lg',
      leading: isMobile ? 'ps-12' : 'ps-10',
      trailing: isMobile ? 'pe-4' : 'pe-3',
    }"
  >
    <template #trailing>
      <UButton
        v-if="modelValue"
        color="neutral"
        variant="link"
        icon="i-heroicons-x-mark-20-solid"
        :padded="false"
        class="text-slate-500 hover:text-white"
        @click="modelValue = ''"
      />
    </template>
  </UInput>
</template>
