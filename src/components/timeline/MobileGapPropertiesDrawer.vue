<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import TrackProperties from '~/components/properties/TrackProperties.vue';
import MobileTimelineDrawer from './MobileTimelineDrawer.vue';
import MobileDrawerToolbar from './MobileDrawerToolbar.vue';
import MobileDrawerToolbarButton from './MobileDrawerToolbarButton.vue';
import type { TimelineTrack } from '~/timeline/types';

interface Props {
  isOpen: boolean;
  trackId: string;
  itemId: string;
}

const props = defineProps<Props>();

const activeSnapPoint = defineModel<string | number | null>('activeSnapPoint', { default: null });

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();
const selectionStore = useSelectionStore();

const isOpenLocal = computed({
  get: () => props.isOpen,
  set: (val) => {
    if (!val) emit('close');
  },
});

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
  emit('close');
}
</script>

<template>
  <MobileTimelineDrawer
    v-model:open="isOpenLocal"
    v-model:active-snap-point="activeSnapPoint"
    force-landscape-direction="bottom"
  >
    <template #toolbar>
      <MobileDrawerToolbar>
        <MobileDrawerToolbarButton
          icon="i-heroicons-trash"
          :label="t('common.delete', 'Delete')"
          @click="deleteGap"
        />
      </MobileDrawerToolbar>
    </template>

    <div class="px-4 pt-4 pb-8">
      <div class="mb-6">
        <p class="text-xs text-ui-text-muted">
          {{ t('fastcat.timeline.gapDescription', 'An empty gap in the track timeline.') }}
        </p>
      </div>

      <div v-if="track">
        <div class="mb-2 text-xs font-bold text-ui-text-muted uppercase tracking-wider">
          {{ t('fastcat.timeline.trackProperties', 'Track Properties') }}
        </div>
        <TrackProperties :track="track" />
      </div>
    </div>
  </MobileTimelineDrawer>
</template>
