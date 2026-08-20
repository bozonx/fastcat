<script setup lang="ts">
import { computed, ref, toRef } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import type { TimelineTrack, VideoClipEffect, AudioClipEffect } from '~/timeline/types';
import ClipEffectsEditor from '~/components/effects/ClipEffectsEditor.vue';
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyActionsBlock from '~/components/properties/PropertyActionsBlock.vue';
import type { PropertyAction } from '~/components/properties/PropertyActionList.vue';
import UiSliderInput from '~/components/ui/UiSliderInput.vue';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import UiRenameModal from '~/components/ui/UiRenameModal.vue';
import PropertyRow from '~/components/properties/PropertyRow.vue';
import GenerateCaptionsModal from '~/components/properties/GenerateCaptionsModal.vue';
import { useTrackExtraActions } from '~/composables/properties/useTrackExtraActions';

const props = defineProps<{
  track: TimelineTrack;
  hideActions?: boolean;
  isMobile?: boolean;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();
const workspaceStore = useWorkspaceStore();

const isDeleteConfirmOpen = ref(false);
const isGenerateCaptionsOpen = ref(false);
const isRenameModalOpen = ref(false);

function handleRenameTrack(name: string) {
  timelineStore.renameTrack(props.track.id, name.trim());
  isRenameModalOpen.value = false;
}

const canDeleteWithoutConfirm = computed(() => (props.track.items?.length ?? 0) === 0);

const TRACK_AUDIO_GAIN_MAX = 2;
const GAIN_PERCENT_MAX = TRACK_AUDIO_GAIN_MAX * 100;

function gainToPercent(gain: unknown): number {
  const value = typeof gain === 'number' && Number.isFinite(gain) ? gain : 1;
  return Math.round(Math.max(0, Math.min(TRACK_AUDIO_GAIN_MAX, value)) * 100);
}

function percentToGain(percent: number): number {
  const value = Number(percent);
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(GAIN_PERCENT_MAX, value)) / 100;
}

const trackAudioGainPercent = computed({
  get: () => {
    return gainToPercent(props.track?.audioGain);
  },
  set: (val: number) => {
    timelineStore.updateTrackProperties(props.track.id, { audioGain: percentToGain(val) });
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

const trackVideoEffects = computed(() =>
  (props.track.effects ?? []).filter(
    (effect): effect is VideoClipEffect => effect?.target !== 'audio',
  ),
);

const trackAudioEffects = computed(() =>
  (props.track.effects ?? []).filter(
    (effect): effect is AudioClipEffect => effect?.target === 'audio',
  ),
);

const isAudioEffectsEnabled = computed(() => workspaceStore.inDevelopmentFeaturesEnabled);

function handleUpdateTrackEffects(effects: Array<VideoClipEffect | AudioClipEffect>) {
  const audioEffects = (props.track.effects ?? []).filter(
    (e): e is AudioClipEffect => e?.target === 'audio',
  );
  timelineStore.updateTrackProperties(props.track.id, {
    effects: [...effects.filter((e) => e.target !== 'audio'), ...audioEffects],
  });
}

function handleUpdateTrackAudioEffects(effects: Array<VideoClipEffect | AudioClipEffect>) {
  const videoEffects = (props.track.effects ?? []).filter((e) => e?.target !== 'audio');
  timelineStore.updateTrackProperties(props.track.id, {
    effects: [...videoEffects, ...effects.filter((e) => e.target === 'audio')],
  });
}

function requestDeleteTrack() {
  const skipConfirm = workspaceStore.userSettings.deleteWithoutConfirmation;
  if (canDeleteWithoutConfirm.value || skipConfirm) {
    timelineStore.deleteTrack(props.track.id, { allowNonEmpty: true });
    return;
  }
  isDeleteConfirmOpen.value = true;
}

function confirmDeleteTrack() {
  timelineStore.deleteTrack(props.track.id, { allowNonEmpty: true });
  isDeleteConfirmOpen.value = false;
}

const trackColor = computed({
  get: () => props.track.color ?? '#2a2a2a',
  set: (val: string) => timelineStore.updateTrackProperties(props.track.id, { color: val }),
});

const trackRef = toRef(props, 'track');

const { extraActions } = useTrackExtraActions({
  track: trackRef,
  timelineStore,
  onGenerateCaptions: () => (isGenerateCaptionsOpen.value = true),
  inDevelopmentFeaturesEnabled: computed(() => workspaceStore.inDevelopmentFeaturesEnabled),
});

const trackQuickActions = computed(() => {
  const actions: PropertyAction[] = [
    {
      id: 'delete',
      title: t('common.delete'),
      icon: 'i-heroicons-trash',
      color: 'neutral',
      variant: 'ghost',
      onClick: requestDeleteTrack,
    },
    {
      id: 'rename',
      title: t('common.rename'),
      icon: 'i-heroicons-pencil',
      color: 'neutral',
      variant: 'ghost',
      onClick: () => {
        isRenameModalOpen.value = true;
      },
    },
  ];

  if (props.track.kind === 'video') {
    const hidden = props.track.videoHidden || false;
    actions.push({
      id: 'toggle-video-hidden',
      title: hidden ? 'Show Track' : 'Hide Track',
      icon: hidden ? 'i-heroicons-eye-slash' : 'i-heroicons-eye',
      color: hidden ? ('primary' as const) : ('neutral' as const),
      variant: hidden ? ('solid' as const) : ('ghost' as const),
      onClick: () => timelineStore.updateTrackProperties(props.track.id, { videoHidden: !hidden }),
    });
  }

  const muted = props.track.audioMuted || false;
  actions.push({
    id: 'toggle-track-muted',
    title: muted ? 'Unmute Track' : 'Mute Track',
    icon: muted ? 'i-heroicons-speaker-x-mark' : 'i-heroicons-speaker-wave',
    color: muted ? ('error' as const) : ('neutral' as const),
    variant: muted ? ('solid' as const) : ('ghost' as const),
    onClick: () => timelineStore.updateTrackProperties(props.track.id, { audioMuted: !muted }),
  });

  const solo = props.track.audioSolo || false;
  actions.push({
    id: 'toggle-solo',
    title: solo ? 'Unsolo Track' : 'Solo Track',
    icon: 'i-heroicons-musical-note',
    color: solo ? ('success' as const) : ('neutral' as const),
    variant: solo ? ('solid' as const) : ('ghost' as const),
    onClick: () => timelineStore.updateTrackProperties(props.track.id, { audioSolo: !solo }),
  });

  const locked = props.track.locked || false;
  actions.push({
    id: 'toggle-track-locked',
    title: locked ? 'Unlock Track' : 'Lock Track',
    icon: locked ? 'i-heroicons-lock-closed' : 'i-heroicons-lock-open',
    color: locked ? ('primary' as const) : ('neutral' as const),
    variant: locked ? ('solid' as const) : ('ghost' as const),
    onClick: () => timelineStore.updateTrackProperties(props.track.id, { locked: !locked }),
  });

  return actions;
});

const clipCount = computed(
  () => (props.track.items ?? []).filter((item) => item.kind === 'clip').length,
);
</script>

<template>
  <div class="w-full flex flex-col gap-2">
    <PropertySection v-if="!hideActions" :title="t('fastcat.track.actions')">
      <PropertyActionsBlock
        :quick-actions="isMobile ? [] : trackQuickActions"
        :additional-actions="extraActions"
      />
    </PropertySection>

    <PropertySection>
      <PropertyRow :label="t('fastcat.track.clipsCount')" :value="clipCount" />
    </PropertySection>

    <PropertySection :title="t('fastcat.track.color')">
      <UiColorPicker
        :model-value="trackColor"
        mode="track"
        @update:model-value="(v) => (trackColor = Array.isArray(v) ? (v[0] ?? trackColor) : v)"
      />
    </PropertySection>

    <PropertySection
      v-if="track.kind === 'audio' || track.kind === 'video'"
      :title="t('videoEditor.audio.sound')"
    >
      <div class="flex flex-col w-full gap-3 py-1">
        <UiSliderInput
          v-model="trackAudioGainPercent"
          :label="t('fastcat.track.audio.volume')"
          :min="0"
          :max="200"
          :step="1"
          :wheel-step-multiplier="1"
          :default-value="100"
          :decimals="0"
          unit="%"
        />

        <UiSliderInput
          v-model="trackAudioBalance"
          :label="t('fastcat.track.audio.balance')"
          :min="-1"
          :max="1"
          :step="0.01"
          :default-value="0"
        />
      </div>
    </PropertySection>

    <ClipEffectsEditor
      v-if="track.kind === 'video'"
      target="video"
      :effects="trackVideoEffects"
      :title="`${t('fastcat.effects.tabs.video')} ${t('fastcat.effects.title').toLowerCase()}`"
      :add-label="t('fastcat.effects.add')"
      :empty-label="t('fastcat.effects.empty')"
      @update:effects="handleUpdateTrackEffects"
    />

    <ClipEffectsEditor
      v-if="isAudioEffectsEnabled && (track.kind === 'audio' || track.kind === 'video')"
      target="audio"
      :effects="trackAudioEffects"
      @update:effects="handleUpdateTrackAudioEffects"
    />

    <UiConfirmModal
      v-model:open="isDeleteConfirmOpen"
      :title="t('fastcat.timeline.deleteTrack')"
      :description="t('fastcat.timeline.deleteTrackConfirm')"
      color="error"
      :confirm-text="t('common.delete')"
      @confirm="confirmDeleteTrack"
    />

    <GenerateCaptionsModal
      v-if="track.kind === 'video'"
      v-model:open="isGenerateCaptionsOpen"
      :track-id="track.id"
    />

    <UiRenameModal
      :open="isRenameModalOpen"
      :current-name="track.name || ''"
      :title="t('fastcat.timeline.renameTrack')"
      @update:open="isRenameModalOpen = $event"
      @rename="handleRenameTrack"
    />
  </div>
</template>
