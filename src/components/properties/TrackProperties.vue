<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { type TimelineTrack } from '~/timeline/types';
import WheelSlider from '~/components/ui/WheelSlider.vue';
import EffectsEditor from '~/components/common/EffectsEditor.vue';

const props = defineProps<{
  track: TimelineTrack;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();

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
</script>

<template>
  <div class="w-full flex flex-col gap-2">
    <div
      class="text-xs font-semibold text-ui-text uppercase tracking-wide border-b border-ui-border pb-1"
    >
      {{ track.name }}
    </div>

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
  </div>
</template>
