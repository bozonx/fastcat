<script setup lang="ts">
const props = defineProps<{
  active: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  toggle: [];
}>();

const { t } = useI18n();
</script>

<template>
  <button
    type="button"
    class="p-1 rounded transition-colors flex items-center justify-center shrink-0 disabled:opacity-50"
    :class="
      props.active
        ? 'text-amber-400 bg-amber-400/20'
        : 'text-ui-text-muted hover:text-ui-text hover:bg-ui-border-elevated'
    "
    :disabled="props.disabled"
    :aria-pressed="props.active"
    :title="
      props.active
        ? t('fastcat.clip.animation.stopwatchTitleActive')
        : t('fastcat.clip.animation.stopwatchTitle')
    "
    @click="emit('toggle')"
  >
    <UIcon name="i-heroicons-clock" class="w-3.5 h-3.5 block" />
  </button>
</template>
