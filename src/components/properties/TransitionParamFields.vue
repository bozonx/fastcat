<script setup lang="ts">
import type { TransitionParamField } from '~/transitions/core/registry';
import ParamsRenderer from '~/components/properties/ParamsRenderer.vue';

defineProps<{
  fields: TransitionParamField[];
  params: Record<string, unknown>;
}>();

const emit = defineEmits<{
  'update:param': [key: string, value: unknown];
}>();

function updateParam(key: string, value: unknown) {
  emit('update:param', key, value);
}
</script>

<template>
  <ParamsRenderer :controls="fields" :values="params" size="xs" @update:value="updateParam" />
</template>
