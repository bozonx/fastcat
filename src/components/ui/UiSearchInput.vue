<script setup lang="ts">
const modelValue = defineModel<string>({ default: '' });

const props = defineProps<{
  placeholder?: string;
  disabled?: boolean;
}>();

const { t } = useI18n();
</script>

<template>
  <UInput
    v-model="modelValue"
    :placeholder="placeholder ?? t('common.search', 'Search')"
    :disabled="disabled"
    icon="i-heroicons-magnifying-glass"
    class="w-full"
  >
    <template #trailing>
      <UButton
        v-if="modelValue"
        color="neutral"
        variant="link"
        icon="i-heroicons-x-mark-20-solid"
        :padded="false"
        @click="modelValue = ''"
      />
    </template>
  </UInput>
</template>
