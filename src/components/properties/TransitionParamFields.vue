<script setup lang="ts">
import type { TransitionParamField } from '~/transitions/core/registry';
import ParamsRenderer from '~/components/properties/ParamsRenderer.vue';

const props = defineProps<{
  fields: TransitionParamField[];
  params: Record<string, any>;
}>();

const emit = defineEmits<{
  'update:param': [key: string, value: any];
}>();

function updateParam(key: string, value: any) {
  emit('update:param', key, value);
}
</script>

<template>
  <ParamsRenderer :controls="fields" :values="params" size="xs" @update:value="updateParam" />
</template>
