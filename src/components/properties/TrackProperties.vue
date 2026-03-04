<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import type { TimelineTrack } from '~/timeline/types';
import WheelSlider from '~/components/ui/WheelSlider.vue';
import EffectsEditor from '~/components/common/EffectsEditor.vue';
import PropertySection from '~/components/properties/PropertySection.vue';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';

const props = defineProps<{
  track: TimelineTrack;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();

const isDeleteConfirmOpen = ref(false);

const canDeleteWithoutConfirm = computed(() => (props.track.items?.length ?? 0) === 0);

const trackAudioGain = computed({
  get: () => {
    const v =
      typeof props.track?.audioGain === 'number' && Number.isFinite(props.track.audioGain)
        ? props.track.audioGain
        : 1;
    return Math.max(0, Math.min(2, v));
  },
  set: (val: number) => {
    const v = Math.max(0, Math.min(2, Number(val)));
    timelineStore.updateTrackProperties(props.track.id, { audioGain: v });
  },
});

const trackAudioBalance = computed({
  get: () => {
    const v =
      typeof props.track?.audioBalance === 'number' && Number.isFinite(props.track.audioBalance)
        ? props.track.audioBalance
        : 0;
    return Math.max(-1, Math.min(1, v));
  },
  set: (val: number) => {
    const v = Math.max(-1, Math.min(1, Number(val)));
    timelineStore.updateTrackProperties(props.track.id, { audioBalance: v });
  },
});

function handleUpdateTrackEffects(effects: any[]) {
  timelineStore.updateTrackProperties(props.track.id, { effects: [...effects] });
}

function handleRenameTrack(newName: string) {
  const next = newName.trim();
  if (!next) return;
  timelineStore.renameTrack(props.track.id, next);
}

function requestDeleteTrack() {
  if (canDeleteWithoutConfirm.value) {
    timelineStore.deleteTrack(props.track.id);
    return;
  }
  isDeleteConfirmOpen.value = true;
}

function confirmDeleteTrack() {
  timelineStore.deleteTrack(props.track.id, { allowNonEmpty: true });
  isDeleteConfirmOpen.value = false;
}
</script>

<template>
  <div class="w-full flex flex-col gap-2">
    <PropertySection :title="t('granVideoEditor.track.actions', 'Actions')">
      <div class="flex gap-2 w-full">
        <UButton
          size="xs"
          variant="soft"
          color="neutral"
          icon="i-heroicons-pencil"
          class="flex-1 justify-center"
          @click="timelineStore.renamingTrackId = track.id"
        >
          {{ t('common.rename', 'Rename') }}
        </UButton>
        <UButton
          size="xs"
          variant="soft"
          color="red"
          icon="i-heroicons-trash"
          class="flex-1 justify-center"
          @click="requestDeleteTrack"
        >
          {{ t('common.delete', 'Delete') }}
        </UButton>
      </div>
    </PropertySection>

    <div
      v-if="track.kind === 'audio' || track.kind === 'video'"
      class="space-y-2 bg-ui-bg-elevated p-2 rounded border border-ui-border"
    >
      <div
        class="text-xs font-semibold text-ui-text uppercase tracking-wide border-b border-ui-border pb-1"
      >
        {{ t('granVideoEditor.track.audio.title', 'Track audio') }}
      </div>

      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <span class="text-xs text-ui-text-muted">{{
            t('granVideoEditor.track.audio.volume', 'Volume')
          }}</span>
          <span class="text-xs font-mono text-ui-text-muted">{{ trackAudioGain.toFixed(3) }}x</span>
        </div>
        <WheelSlider
          :model-value="trackAudioGain"
          :min="0"
          :max="2"
          :step="0.001"
          :wheel-step-multiplier="10"
          :default-value="1"
          @update:model-value="(v: any) => (trackAudioGain = Number(v))"
        />
      </div>

      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <span class="text-xs text-ui-text-muted">{{
            t('granVideoEditor.track.audio.balance', 'Balance')
          }}</span>
          <span class="text-xs font-mono text-ui-text-muted">{{
            trackAudioBalance.toFixed(2)
          }}</span>
        </div>
        <WheelSlider
          :model-value="trackAudioBalance"
          :min="-1"
          :max="1"
          :step="0.01"
          :default-value="0"
          @update:model-value="(v: any) => (trackAudioBalance = Number(v))"
        />
      </div>
    </div>

    <EffectsEditor
      :effects="track.effects"
      :title="t('granVideoEditor.effects.trackTitle', 'Track effects')"
      :add-label="t('granVideoEditor.effects.add', 'Add')"
      :empty-label="t('granVideoEditor.effects.empty', 'No effects')"
      @update:effects="handleUpdateTrackEffects"
    />



    <UiConfirmModal
      v-model:open="isDeleteConfirmOpen"
      :title="t('granVideoEditor.timeline.deleteTrack', 'Delete track')"
      :description="
        t('granVideoEditor.timeline.deleteTrackConfirm', 'This track contains clips. Delete it?')
      "
      color="error"
      :confirm-text="t('common.delete', 'Delete')"
      @confirm="confirmDeleteTrack"
    />
  </div>
</template>
