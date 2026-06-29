<script setup lang="ts">
import { computed, ref, toRef } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import {
  BLEND_MODE_OPTIONS as RAW_BLEND_MODE_OPTIONS,
  isTimelineBlendMode,
} from '~/utils/constants';
import type {
  TimelineBlendMode,
  TimelineTrack,
  VideoClipEffect,
  AudioClipEffect,
} from '~/timeline/types';
import ClipEffectsEditor from '~/components/effects/ClipEffectsEditor.vue';
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyActionsBlock from '~/components/properties/PropertyActionsBlock.vue';
import UiSliderInput from '~/components/ui/UiSliderInput.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
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

const blendModeOptions = computed<Array<{ value: TimelineBlendMode; label: string }>>(() =>
  RAW_BLEND_MODE_OPTIONS.map((opt) => ({
    value: opt.value as TimelineBlendMode,
    label: t(opt.labelKey),
  })),
);

const trackOpacity = computed({
  get: () => {
    const v =
      typeof props.track?.opacity === 'number' && Number.isFinite(props.track.opacity)
        ? props.track.opacity
        : 1;
    return Math.max(0, Math.min(1, v));
  },
  set: (val: number) => {
    const v = Math.max(0, Math.min(1, Number(val)));
    timelineStore.updateTrackProperties(props.track.id, { opacity: v });
  },
});

const trackBlendMode = computed({
  get: () => props.track?.blendMode ?? 'normal',
  set: (val: TimelineBlendMode | string) => {
    const safe = isTimelineBlendMode(val) ? val : 'normal';
    timelineStore.updateTrackProperties(props.track.id, { blendMode: safe });
  },
});

const trackAudioGain = computed({
  get: () => {
    const v =
      typeof props.track?.audioGain === 'number' && Number.isFinite(props.track.audioGain)
        ? props.track.audioGain
        : 1;
    return Math.max(0, Math.min(4, v));
  },
  set: (val: number) => {
    const v = Math.max(0, Math.min(4, Number(val)));
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
  experimentalFeatures: computed(() => workspaceStore.inDevelopmentFeaturesEnabled),
});

const trackQuickActions = computed(() => {
  const actions: import('~/components/properties/PropertyActionsBlock.vue').PropertyActionItem[] = [
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
    id: 'toggle-muted',
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
    id: 'toggle-locked',
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

    <PropertySection v-if="track.kind === 'video'" :title="t('common.properties')">
      <div class="flex flex-col w-full gap-4 py-1">
        <div class="flex flex-col gap-1">
          <span class="text-xs text-ui-text-muted font-medium">{{
            t('fastcat.track.blendMode')
          }}</span>
          <UiSelect
            :model-value="trackBlendMode"
            :items="blendModeOptions"
            value-key="value"
            label-key="label"
            size="sm"
            :searchable="false"
            @update:model-value="
              (v: unknown) =>
                (trackBlendMode =
                  (v as { value: TimelineBlendMode })?.value ?? (v as TimelineBlendMode))
            "
          />
        </div>

        <UiSliderInput
          v-model="trackOpacity"
          :label="t('fastcat.track.opacity')"
          unit="%"
          :min="0"
          :max="1"
          :step="0.01"
          :default-value="1"
        />
      </div>
    </PropertySection>

    <PropertySection
      v-if="track.kind === 'audio' || track.kind === 'video'"
      :title="t('videoEditor.audio.sound')"
    >
      <div class="flex flex-col w-full gap-3 py-1">
        <UiSliderInput
          v-model="trackAudioGain"
          :label="t('fastcat.track.audio.volume')"
          :min="0"
          :max="2"
          :step="0.001"
          :wheel-step-multiplier="10"
          :default-value="1"
          unit="x"
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
      v-if="track.kind === 'audio' || track.kind === 'video'"
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
