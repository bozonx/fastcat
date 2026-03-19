<script setup lang="ts">
import { computed } from 'vue';
import PropertyActionList from '~/components/properties/PropertyActionList.vue';

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
    label: undefined, // Primary actions in EntryActions are icon-only
  })),
);

const mappedSecondary = computed(() =>
  props.secondaryActions.map((a) => ({
    ...a,
  })),
);
</script>

<template>
  <div class="flex flex-col gap-2 w-full">
    <!-- Primary Actions (Horizontal Icons) -->
    <PropertyActionList
      v-if="mappedPrimary.length > 0"
      :actions="mappedPrimary"
      :vertical="false"
      variant="ghost"
      size="xs"
    />

    <!-- Secondary Actions (Vertical Text Buttons) -->
    <PropertyActionList v-if="mappedSecondary.length > 0" :actions="mappedSecondary" size="xs" />
  </div>
</template>
