<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import type { TimelineTrack, TimelineGapItem, TimelineTrackItem } from '~/timeline/types';
import TrackProperties from '~/components/properties/TrackProperties.vue';
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyRow from '~/components/properties/PropertyRow.vue';
import PropertyActionsBlock from '~/components/properties/PropertyActionsBlock.vue';
import { formatTimecode } from '~/utils/time';

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

const gap = computed<TimelineGapItem | null>(
  () =>
    ((track.value?.items as TimelineTrackItem[] | undefined)?.find(
      (item) => item.id === props.itemId && item.kind === 'gap',
    ) as TimelineGapItem | null) ?? null,
);

const fps = computed(() => timelineStore.timelineFormat.fps || 30);
const gapDuration = computed(() => gap.value?.timelineRange.durationTicks ?? 0);
const formattedGapDuration = computed(() => formatTimecode(gapDuration.value, fps.value));

const gapActions = computed(() => [
  {
    id: 'delete-gap',
    label: t('fastcat.timeline.deleteGap'),
    icon: 'i-heroicons-trash',
    color: 'neutral' as const,
    variant: 'soft' as const,
    showHotkeyInLabel: false,
    onClick: deleteGap,
  },
]);

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
    <!-- Gap properties panel -->
    <PropertySection :title="t('fastcat.timeline.gap')">
      <PropertyRow :label="t('common.duration')" :value="formattedGapDuration" />
      <div v-if="!hideActions" class="mt-2 pt-2 border-t border-ui-border">
        <PropertyActionsBlock :additional-actions="gapActions" />
      </div>
    </PropertySection>

    <!-- Track divider -->
    <div
      v-if="track"
      class="text-xs font-bold text-ui-text-muted px-2 py-1 mt-2 uppercase tracking-wider"
    >
      {{ t('fastcat.track.trackName', { name: track.name }) }}
    </div>

    <!-- Track properties below -->
    <TrackProperties v-if="track" :track="track" :hide-actions="hideActions" />
  </div>
</template>
