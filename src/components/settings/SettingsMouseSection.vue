<script setup lang="ts">
import UiFormSectionHeader from '~/components/ui/UiFormSectionHeader.vue';

interface Props {
  title: string;
  infoTitle?: string;
  infoItems: string[];
  infoColumns?: boolean;
}

defineProps<Props>();
</script>

<template>
  <div class="flex flex-col gap-3">
    <UiFormSectionHeader :title="title" class="px-1" />

    <div class="overflow-hidden rounded-lg border border-ui-border bg-ui-bg">
      <table class="w-full border-collapse">
        <tbody class="divide-y divide-ui-border">
          <slot />
        </tbody>
      </table>
    </div>

    <div
      v-if="infoItems.length"
      class="mt-2 rounded border border-ui-border/30 bg-ui-bg-accent/5 px-1 py-1.5"
      :class="{ 'text-ui-text-muted': !infoTitle }"
    >
      <UiFormSectionHeader v-if="infoTitle" :title="infoTitle" class="px-1 mt-0! mb-1.5!">
        <template #default>
          <div class="flex items-center gap-1.5">
            <UIcon name="i-heroicons-information-circle" class="h-3 w-3" />
          </div>
        </template>
      </UiFormSectionHeader>

      <ul
        class="px-1"
        :class="infoColumns ? 'grid grid-cols-1 gap-x-4 gap-y-1 md:grid-cols-2' : 'space-y-1'"
      >
        <li
          v-for="item in infoItems"
          :key="item"
          class="flex items-start gap-2 text-2xs leading-tight text-ui-text-muted"
        >
          <span class="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ui-border/50" />
          {{ item }}
        </li>
      </ul>
    </div>
  </div>
</template>
