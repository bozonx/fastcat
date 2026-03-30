<script setup lang="ts">
interface Props {
  icon: string;
  label?: string;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
}

defineProps<Props>();
defineEmits<{ click: [] }>();
</script>

<template>
  <button
    class="flex flex-col items-center justify-center gap-0.5 rounded-xl px-3 py-2 min-w-[52px] shrink-0 transition-all outline-none"
    :class="[
      danger
        ? 'text-red-400 bg-red-400/10'
        : active
          ? 'text-primary-400 bg-primary-400/15 border border-primary-500/30'
          : 'text-slate-200 bg-slate-800/50',
      disabled ? 'opacity-40 pointer-events-none' : 'active:scale-95',
    ]"
    :disabled="disabled"
    @click="$emit('click')"
  >
    <UIcon :name="icon" class="w-5 h-5 shrink-0" />
    <span v-if="label" class="text-[9px] font-medium leading-tight">{{ label }}</span>
  </button>
</template>
