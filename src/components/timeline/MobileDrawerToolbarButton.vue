<script setup lang="ts">
interface Props {
  icon: string;
  label?: string;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  success?: boolean;
  primary?: boolean;
}

defineProps<Props>();
defineEmits<{ click: [] }>();
</script>

<template>
  <button
    data-vaul-no-drag
    class="mobile-drawer-toolbar-button flex flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 w-[54px] h-[54px] shrink-0 transition-all outline-none"
    :class="[
      danger
        ? 'text-red-400 bg-red-400/10'
        : success
          ? 'text-white bg-ui-action border-none shadow-lg shadow-ui-action/20'
          : primary
            ? 'text-white bg-blue-500 border-none shadow-lg shadow-blue-500/20'
            : active
              ? 'text-blue-400 bg-blue-400/15 border border-blue-500/30'
              : 'text-ui-text bg-ui-bg-muted/50',
      disabled ? 'opacity-40 pointer-events-none' : 'active:scale-95',
    ]"
    :disabled="disabled"
    @click="$emit('click')"
  >
    <UIcon :name="icon" class="w-5 h-5 shrink-0" />
    <!-- Label line height is always reserved (block + fixed h-3) so icons line up
         across labeled and unlabeled buttons in the same toolbar row. -->
    <span class="block h-3 max-w-full text-[10px] font-medium leading-3 antialiased truncate">{{
      label
    }}</span>
  </button>
</template>
