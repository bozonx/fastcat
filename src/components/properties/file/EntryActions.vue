<script setup lang="ts">
import { computed } from 'vue';

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
  color?: string;
  disabled?: boolean;
  hidden?: boolean;
  onClick: () => void;
}

const props = defineProps<{
  primaryActions: PrimaryAction[];
  secondaryActions: SecondaryAction[];
}>();

const visiblePrimary = computed(() => props.primaryActions.filter((a) => !a.hidden));
const visibleSecondary = computed(() => props.secondaryActions.filter((a) => !a.hidden));
</script>

<template>
  <div class="flex flex-col gap-2 w-full">
    <div v-if="visiblePrimary.length > 0" class="flex items-center gap-1">
      <UButton
        v-for="a in visiblePrimary"
        :key="a.id"
        size="xs"
        color="neutral"
        variant="ghost"
        :icon="a.icon"
        :title="a.title"
        :disabled="a.disabled"
        @click="a.onClick"
      />
    </div>

    <div v-if="visibleSecondary.length > 0" class="flex flex-col gap-2">
      <UButton
        v-for="a in visibleSecondary"
        :key="a.id"
        size="xs"
        :color="a.color ?? 'neutral'"
        variant="soft"
        class="w-full"
        :icon="a.icon"
        :disabled="a.disabled"
        @click="a.onClick"
      >
        {{ a.label }}
      </UButton>
    </div>
  </div>
</template>
