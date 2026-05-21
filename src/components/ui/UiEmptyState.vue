<script setup lang="ts">
interface Props {
  message: string;
  icon?: string;
  iconClass?: string;
  wrapperClass?: string;
}

withDefaults(defineProps<Props>(), {
  icon: undefined,
  iconClass: 'w-6 h-6 mx-auto mb-2 opacity-40',
  wrapperClass: undefined,
});
</script>

<template>
  <div class="text-center text-ui-text-muted py-4 text-xs italic" :class="$props.wrapperClass">
    <UIcon v-if="icon" :name="icon" :class="iconClass" />
    <span>{{ message }}</span>
  </div>
</template>
