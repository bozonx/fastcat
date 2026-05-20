<script setup lang="ts">
import { computed } from 'vue';
import PropertyActionsBlock from '~/components/properties/PropertyActionsBlock.vue';

interface PrimaryAction {
  id: string;
  title: string;
  icon: string;
  disabled?: boolean;
  hidden?: boolean;
  onClick: () => void;
}

interface SecondaryAction {
  id: string;
  label: string;
  icon?: string;
  color?: any;
  disabled?: boolean;
  hidden?: boolean;
  onClick: () => void;
}

const props = defineProps<{
  primaryActions: PrimaryAction[];
  secondaryActions: SecondaryAction[];
}>();

const mappedPrimary = computed(() =>
  props.primaryActions.map((a) => ({
    ...a,
    label: undefined,
  })),
);
</script>

<template>
  <PropertyActionsBlock
    :quick-actions="mappedPrimary"
    :additional-actions="secondaryActions"
  />
</template>
