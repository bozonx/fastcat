<script setup lang="ts">
interface TimelineUsage {
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
  <div
    v-if="props.usages.length > 0"
    class="space-y-1 bg-ui-bg-elevated p-2 rounded border border-ui-border w-full"
  >
    <div
      class="text-[10px] font-bold text-ui-text-muted uppercase tracking-widest border-b border-ui-border pb-1"
    >
      {{ t('fastcat.preview.usedInTimelines', 'Used in timelines') }}
    </div>
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
        {{ usage.timelineName.replace('.otio', '') }}
      </UButton>
    </div>
  </div>
</template>
