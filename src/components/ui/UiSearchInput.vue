<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  modelValue: string;
  placeholder?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const { t } = useI18n();

const localValue = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
});

function clear() {
  localValue.value = '';
}
</script>

<template>
  <div class="relative w-full">
    <UInput
      v-model="localValue"
      :placeholder="placeholder ?? t('common.search', 'Search')"
      :disabled="disabled"
      icon="i-heroicons-magnifying-glass"
      class="w-full"
    >
      <template #trailing>
        <UButton
          v-if="localValue"
          color="neutral"
          variant="link"
          icon="i-heroicons-x-mark-20-solid"
          :padded="false"
          @click="clear"
        />
      </template>
    </UInput>
  </div>
</template>
