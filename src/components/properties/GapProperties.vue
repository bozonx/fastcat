<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import type { TimelineTrack } from '~/timeline/types';
import TrackProperties from '~/components/properties/TrackProperties.vue';
import PropertySection from '~/components/properties/PropertySection.vue';

const props = defineProps<{
  trackId: string;
  itemId: string;
  hideActions?: boolean;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();
const selectionStore = useSelectionStore();

const track = computed<TimelineTrack | null>(
  () =>
    (timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined)?.find(
      (tr) => tr.id === props.trackId,
    ) ?? null,
);

function deleteGap() {
  timelineStore.applyTimeline({
    type: 'delete_items',
    trackId: props.trackId,
    itemIds: [props.itemId],
  });
  timelineStore.clearSelection();
  selectionStore.clearSelection();
}
</script>

<template>
  <div class="w-full flex flex-col gap-2 text-ui-text">
    <!-- Gap actions panel -->
    <PropertySection v-if="!hideActions" :title="t('fastcat.timeline.gap')">
      <div class="px-3 pb-3">
        <p class="text-xs text-ui-text-muted mb-3">
          {{ t('fastcat.timeline.gapDescription') }}
        </p>
        <UButton
          color="error"
          variant="soft"
          size="xs"
          icon="i-heroicons-trash"
          class="w-full justify-center"
          @click="deleteGap"
        >
          {{ t('fastcat.timeline.deleteGap') }}
        </UButton>
      </div>
    </PropertySection>

    <!-- Track properties below -->
    <TrackProperties v-if="track" :track="track" :hide-actions="hideActions" />
  </div>
</template>
