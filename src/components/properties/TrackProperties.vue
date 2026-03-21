<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { trackColorPresets, blendModeOptions as rawBlendModeOptions } from '~/utils/constants';
import type {
  TimelineBlendMode,
  TimelineTrack,
  VideoClipEffect,
  AudioClipEffect,
} from '~/timeline/types';
import EffectsEditor from '~/components/effects/EffectsEditor.vue';
import AudioEffectsEditor from '~/components/effects/AudioEffectsEditor.vue';
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyActionList from '~/components/properties/PropertyActionList.vue';
import UiSliderInput from '~/components/ui/UiSliderInput.vue';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import GenerateCaptionsModal from '~/components/properties/GenerateCaptionsModal.vue';

const props = defineProps<{
  track: TimelineTrack;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();
const workspaceStore = useWorkspaceStore();

const isDeleteConfirmOpen = ref(false);
const isGenerateCaptionsOpen = ref(false);

const canDeleteWithoutConfirm = computed(() => (props.track.items?.length ?? 0) === 0);

const blendModeOptions = computed<Array<{ value: TimelineBlendMode; label: string }>>(() =>
  rawBlendModeOptions.map((opt) => ({
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
    const safe =
      val === 'add' ||
      val === 'multiply' ||
      val === 'screen' ||
      val === 'darken' ||
      val === 'lighten'
        ? val
        : 'normal';

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

function handleUpdateTrackEffects(effects: VideoClipEffect[]) {
  const audioEffects = (props.track.effects ?? []).filter(
    (e): e is AudioClipEffect => e?.target === 'audio',
  );
  timelineStore.updateTrackProperties(props.track.id, {
    effects: [...effects, ...audioEffects] as (VideoClipEffect | AudioClipEffect)[],
  });
}

function handleUpdateTrackAudioEffects(effects: AudioClipEffect[]) {
  const videoEffects = (props.track.effects ?? []).filter((e) => e?.target !== 'audio');
  timelineStore.updateTrackProperties(props.track.id, {
    effects: [...videoEffects, ...effects] as (VideoClipEffect | AudioClipEffect)[],
  });
}

function handleRenameTrack(newName: string) {
  const next = newName.trim();
  if (!next) return;
  timelineStore.renameTrack(props.track.id, next);
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

const isLocked = computed({
  get: () => props.track.locked ?? false,
  set: (val: boolean) => timelineStore.updateTrackProperties(props.track.id, { locked: val }),
});

const isMuted = computed({
  get: () =>
    props.track.kind === 'video' ? props.track.videoHidden : props.track.audioMuted ?? false,
  set: (val: boolean) => {
    if (props.track.kind === 'video') {
      timelineStore.updateTrackProperties(props.track.id, { videoHidden: val });
    } else {
      timelineStore.updateTrackProperties(props.track.id, { audioMuted: val });
    }
  },
});

const isSolo = computed({
  get: () => props.track.audioSolo ?? false,
  set: (val: boolean) => timelineStore.updateTrackProperties(props.track.id, { audioSolo: val }),
});

const mainActions = computed(() => [
  {
    id: 'rename',
    title: t('common.rename', 'Rename'),
    icon: 'i-heroicons-pencil',
    onClick: () => (timelineStore.renamingTrackId = props.track.id),
  },
  {
    id: 'delete',
    title: t('common.delete', 'Delete'),
    icon: 'i-heroicons-trash',
    onClick: requestDeleteTrack,
  },
]);

const extraActions = computed(() => {
  const list: Array<{
    id: string;
    label: string;
    icon: string;
    color?: 'primary' | 'danger' | 'warning' | 'success' | 'neutral';
    onClick: () => void;
  }> = [];
  if (props.track.kind === 'video') {
    list.push({
      id: 'generate-captions',
      label: t('fastcat.captions.generate', 'Generate captions'),
      icon: 'i-heroicons-chat-bubble-bottom-center-text',
      color: 'primary',
      onClick: () => (isGenerateCaptionsOpen.value = true),
    });
  }
  return list;
});
</script>

<template>
  <div class="w-full flex flex-col gap-2">
    <PropertySection :title="t('fastcat.track.actions', 'Actions')">
      <div class="flex flex-col w-full gap-2">
        <div class="flex items-center justify-around pb-2 border-b border-ui-border">
          <UButton
            :icon="isLocked ? 'i-heroicons-lock-closed' : 'i-heroicons-lock-open'"
            size="sm"
            :color="isLocked ? 'primary' : 'neutral'"
            variant="ghost"
            :title="t('fastcat.track.lock', 'Lock track')"
            @click="isLocked = !isLocked"
          />
          <UButton
            :icon="isMuted ? 'i-heroicons-eye-slash' : 'i-heroicons-eye'"
            size="sm"
            :color="isMuted ? 'danger' : 'neutral'"
            variant="ghost"
            :title="t('fastcat.track.mute', 'Mute/Hide track')"
            @click="isMuted = !isMuted"
          />
          <UButton
            v-if="track.kind === 'audio' || track.kind === 'video'"
            icon="i-heroicons-star"
            size="sm"
            :color="isSolo ? 'warning' : 'neutral'"
            variant="ghost"
            :title="t('fastcat.track.solo', 'Solo track')"
            @click="isSolo = !isSolo"
          />
        </div>

        <div class="flex flex-col gap-1.5 pt-1 px-1">
          <span class="text-[10px] text-ui-text-muted uppercase tracking-wider font-semibold">
            {{ t('fastcat.track.color', 'Track color') }}
          </span>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="preset in trackColorPresets"
              :key="preset"
              class="w-5 h-5 rounded-full border border-ui-border-elevated transition-transform hover:scale-110"
              :class="{ 'ring-2 ring-ui-primary ring-offset-1 ring-offset-ui-bg': trackColor === preset }"
              :style="{ backgroundColor: preset }"
              @click="trackColor = preset"
            />
          </div>
        </div>

        <PropertyActionList :actions="mainActions" :vertical="false" variant="ghost" justify="start" size="xs" />
        <PropertyActionList :actions="extraActions" justify="start" size="xs" />
      </div>
    </PropertySection>

    <div
      v-if="track.kind === 'video'"
      class="space-y-2 bg-ui-bg-elevated p-2 rounded border border-ui-border"
    >
      <div
        class="text-xs font-semibold text-ui-text uppercase tracking-wide border-b border-ui-border pb-1"
      >
        {{ t('fastcat.track.video.title', 'Track compositing') }}
      </div>

      <div class="flex flex-col gap-0.5">
        <span class="text-xs text-ui-text-muted">{{
          t('fastcat.track.blendMode', 'Blend mode')
        }}</span>
        <USelectMenu
          :model-value="trackBlendMode"
          :items="blendModeOptions"
          value-key="value"
          label-key="label"
          size="sm"
          @update:model-value="(v: any) => (trackBlendMode = v)"
        />
      </div>

      <UiSliderInput
        :label="t('fastcat.track.opacity', 'Opacity')"
        :formatted-value="`${Math.round(trackOpacity * 100)}%`"
        :model-value="trackOpacity"
        :min="0"
        :max="1"
        :step="0.01"
        :default-value="1"
        @update:model-value="(v: number) => (trackOpacity = v)"
      />
    </div>

    <div
      v-if="track.kind === 'audio' || track.kind === 'video'"
      class="space-y-2 bg-ui-bg-elevated p-2 rounded border border-ui-border"
    >
      <div
        class="text-xs font-semibold text-ui-text uppercase tracking-wide border-b border-ui-border pb-1"
      >
        {{ t('fastcat.track.audio.title', 'Track audio') }}
      </div>

      <UiSliderInput
        :label="t('fastcat.track.audio.volume', 'Volume')"
        :formatted-value="`${trackAudioGain.toFixed(3)}x`"
        :model-value="trackAudioGain"
        :min="0"
        :max="2"
        :step="0.001"
        :wheel-step-multiplier="10"
        :default-value="1"
        @update:model-value="(v: number) => (trackAudioGain = v)"
      />

      <UiSliderInput
        :label="t('fastcat.track.audio.balance', 'Balance')"
        :formatted-value="trackAudioBalance.toFixed(2)"
        :model-value="trackAudioBalance"
        :min="-1"
        :max="1"
        :step="0.01"
        :default-value="0"
        @update:model-value="(v: number) => (trackAudioBalance = v)"
      />
    </div>

    <EffectsEditor
      v-if="track.kind === 'video'"
      :effects="trackVideoEffects"
      :title="t('fastcat.effects.trackTitle', 'Track effects')"
      :add-label="t('fastcat.effects.add', 'Add')"
      :empty-label="t('fastcat.effects.empty', 'No effects')"
      @update:effects="handleUpdateTrackEffects"
    />

    <AudioEffectsEditor
      v-if="track.kind === 'audio' || track.kind === 'video'"
      :effects="trackAudioEffects"
      @update:effects="handleUpdateTrackAudioEffects"
    />

    <UiConfirmModal
      v-model:open="isDeleteConfirmOpen"
      :title="t('fastcat.timeline.deleteTrack', 'Delete track')"
      :description="
        t('fastcat.timeline.deleteTrackConfirm', 'This track contains clips. Delete it?')
      "
      color="error"
      :confirm-text="t('common.delete', 'Delete')"
      @confirm="confirmDeleteTrack"
    />

    <GenerateCaptionsModal
      v-if="track.kind === 'video'"
      v-model:open="isGenerateCaptionsOpen"
      :track-id="track.id"
    />
  </div>
</template>
