<script setup lang="ts">
import PropertySection from '~/components/properties/PropertySection.vue';

export interface TimelineUsage {
  timelinePath: string;
  timelineName: string;
}

const props = defineProps<{
  usages: TimelineUsage[];
  openTimelineFromUsage: (timelinePath: string) => void;
}>();

const { t } = useI18n();
</script>

<template>
  <PropertySection
    v-if="props.usages.length > 0"
    :title="t('fastcat.preview.usedInTimelines', 'Used in timelines')"
  >
    <div class="flex flex-wrap gap-1 mt-1">
      <UButton
        v-for="usage in props.usages"
        :key="usage.timelinePath"
        size="xs"
        variant="soft"
        color="neutral"
        icon="i-heroicons-clock"
        @click="props.openTimelineFromUsage(usage.timelinePath)"
      >
        {{ usage.timelineName }}
      </UButton>
    </div>
  </PropertySection>
</template>
