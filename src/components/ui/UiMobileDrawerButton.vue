<script setup lang="ts">
interface Props {
  icon?: string;
  label?: string;
  disabled?: boolean;
  active?: boolean;
  variant?: 'neutral' | 'danger' | 'primary' | 'warning';
}

const props = withDefaults(defineProps<Props>(), {
  icon: undefined,
  label: undefined,
  disabled: false,
  active: false,
  variant: 'neutral',
});

const emit = defineEmits<{
  (e: 'click'): void;
}>();

const variantClasses = computed(() => {
  if (props.disabled)
    return 'opacity-40 pointer-events-none bg-zinc-800/40 border border-zinc-700/50 text-zinc-400';

  switch (props.variant) {
    case 'danger':
      return 'text-red-400 bg-red-400/10 border border-red-400/20 active:bg-red-400/20';
    case 'primary':
      return 'text-primary-400 bg-primary-400/10 border border-primary-400/30 active:bg-primary-400/20';
    case 'warning':
      return 'text-amber-400 bg-amber-400/10 border border-amber-400/30 active:bg-amber-400/20';
    default:
      return props.active
        ? 'text-primary-400 bg-primary-400/10 border border-primary-400/30'
        : 'text-zinc-200 bg-zinc-800/40 border border-zinc-700/50 active:bg-zinc-800/60';
  }
});
</script>

<template>
  <button
    class="flex flex-col items-center justify-center gap-1 rounded-lg py-2 px-1 text-center transition-all outline-none active:scale-95 min-h-[58px]"
    :class="variantClasses"
    @click="emit('click')"
  >
    <UIcon v-if="props.icon" :name="props.icon" class="w-4 h-4 shrink-0" />
    <span v-if="props.label" class="text-[9px] font-medium leading-tight truncate w-full px-0.5">
      {{ props.label }}
    </span>
  </button>
</template>
