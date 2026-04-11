<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import TrackProperties from '~/components/properties/TrackProperties.vue';
import MobileTimelineDrawer from './MobileTimelineDrawer.vue';
import MobileDrawerToolbar from './MobileDrawerToolbar.vue';
import MobileDrawerToolbarButton from './MobileDrawerToolbarButton.vue';
import PropertyActionList from '~/components/properties/PropertyActionList.vue';
import GenerateCaptionsModal from '~/components/properties/GenerateCaptionsModal.vue';
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

const isGenerateCaptionsOpen = ref(false);

const trackExtraActions = computed(() => {
  if (!track.value) return [];
  const list: any[] = [];
  if (track.value.kind === 'video') {
    list.push({
      id: 'generate-captions',
      label: t('fastcat.captions.generate'),
      icon: 'i-heroicons-chat-bubble-bottom-center-text',
      onClick: () => (isGenerateCaptionsOpen.value = true),
    });
  }
  return list;
});
</script>

<template>
  <MobileTimelineDrawer
    v-model:open="isOpenLocal"
    v-model:active-snap-point="activeSnapPoint"
    force-landscape-direction="bottom"
  >
    <div class="px-4 pb-8">
      <div class="mb-4 pt-1">
        <MobileDrawerToolbar class="-mx-4 mb-2">
          <MobileDrawerToolbarButton
            icon="i-heroicons-trash"
            :label="t('common.delete')"
            @click="deleteGap"
          />
        </MobileDrawerToolbar>

        <div v-if="trackExtraActions.length > 0" class="py-1 px-3 border border-ui-border rounded-xl bg-zinc-900/40">
          <PropertyActionList
            :actions="trackExtraActions"
            vertical
            variant="ghost"
            size="md"
          />
        </div>
      </div>

      <div class="mb-6">
        <p class="text-xs text-ui-text-muted">
          {{ t('fastcat.timeline.gapDescription') }}
        </p>
      </div>

      <div v-if="track">
        <div class="mb-2 text-xs font-bold text-ui-text-muted uppercase tracking-wider">
          {{ t('fastcat.timeline.trackProperties') }}
        </div>
        <TrackProperties :track="track" hide-actions />
      </div>

      <GenerateCaptionsModal
        v-if="track?.kind === 'video'"
        v-model:open="isGenerateCaptionsOpen"
        :track-id="track.id"
      />
    </div>
  </MobileTimelineDrawer>
</template>
