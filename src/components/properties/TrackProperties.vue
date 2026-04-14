<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { BLEND_MODE_OPTIONS as RAW_BLEND_MODE_OPTIONS } from '~/utils/constants';
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
import UiSelect from '~/components/ui/UiSelect.vue';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import PropertyRow from '~/components/properties/PropertyRow.vue';
import GenerateCaptionsModal from '~/components/properties/GenerateCaptionsModal.vue';

const props = defineProps<{
  track: TimelineTrack;
  hideActions?: boolean;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();
const workspaceStore = useWorkspaceStore();

const isDeleteConfirmOpen = ref(false);
const isGenerateCaptionsOpen = ref(false);

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

const isSolo = computed({
  get: () => props.track.audioSolo ?? false,
  set: (val: boolean) => timelineStore.updateTrackProperties(props.track.id, { audioSolo: val }),
});

const sameKindTracks = computed(() =>
  (timelineStore.timelineDoc?.tracks ?? []).filter((track) => track.kind === props.track.kind),
);

const nextTrackIndex = computed(() => sameKindTracks.value.length + 1);

function createTrack(options: { insertBeforeId?: string; insertAfterId?: string }) {
  const nextName = `${props.track.kind === 'video' ? 'Video' : 'Audio'} ${nextTrackIndex.value}`;
  timelineStore.addTrack(props.track.kind, nextName, options);
}

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
      label: t('fastcat.captions.generate'),
      icon: 'i-heroicons-chat-bubble-bottom-center-text',
      onClick: () => (isGenerateCaptionsOpen.value = true),
    });
  }

  list.push(
    {
      id: 'create-above',
      label: t(`fastcat.timeline.add${props.track.kind === 'video' ? 'Video' : 'Audio'}TrackAbove`),
      icon: props.track.kind === 'video' ? 'i-heroicons-video-camera' : 'i-heroicons-musical-note',
      onClick: () => createTrack({ insertBeforeId: props.track.id }),
    },
    {
      id: 'create-below',
      label: t(`fastcat.timeline.add${props.track.kind === 'video' ? 'Video' : 'Audio'}TrackBelow`),
      icon: props.track.kind === 'video' ? 'i-heroicons-video-camera' : 'i-heroicons-musical-note',
      onClick: () => createTrack({ insertAfterId: props.track.id }),
    },
  );

  // Track reordering actions
  const isFirst = sameKindTracks.value[0]?.id === props.track.id;
  const isLast = sameKindTracks.value.at(-1)?.id === props.track.id;

  if (!isFirst) {
    list.push({
      id: 'move-up',
      label: t('fastcat.track.moveUp'),
      icon: 'i-heroicons-arrow-up',
      onClick: () => timelineStore.moveTrackUp(props.track.id),
    });
  }

  if (!isLast) {
    list.push({
      id: 'move-down',
      label: t('fastcat.track.moveDown'),
      icon: 'i-heroicons-arrow-down',
      onClick: () => timelineStore.moveTrackDown(props.track.id),
    });
  }

  return list;
});

const clipCount = computed(
  () => (props.track.items ?? []).filter((item) => item.kind === 'clip').length,
);
</script>

<template>
  <div class="w-full flex flex-col gap-2">
    <PropertySection v-if="!hideActions" :title="t('fastcat.track.actions')">
      <div class="flex flex-col w-full gap-3">
        <div class="flex items-center gap-1.5 py-1">
          <div class="flex items-center gap-1">
            <UiActionButton
              icon="i-heroicons-trash"
              size="sm"
              color="neutral"
              :title="t('common.delete')"
              @click="requestDeleteTrack"
            />
            <UiActionButton
              icon="i-heroicons-pencil"
              size="sm"
              color="neutral"
              :title="t('common.rename')"
              @click="timelineStore.renamingTrackId = props.track.id"
            />
          </div>

          <div class="h-4 w-px bg-ui-border mx-1 opacity-50" />

          <UiToggleButton
            v-if="track.kind === 'video'"
            :model-value="props.track.videoHidden || false"
            icon="i-heroicons-eye"
            active-icon="i-heroicons-eye-slash"
            inactive-color="neutral"
            active-color="primary"
            :active-bg="'#ffffff'"
            :active-text="'#000000'"
            title="Toggle visibility"
            @click="
              timelineStore.updateTrackProperties(props.track.id, {
                videoHidden: !props.track.videoHidden,
              })
            "
          />
          <UiToggleButton
            :model-value="props.track.audioMuted || false"
            icon="i-heroicons-speaker-wave"
            active-icon="i-heroicons-speaker-x-mark"
            inactive-color="neutral"
            active-color="error"
            :active-bg="'#ef4444'"
            :active-text="'#000000'"
            title="Toggle mute"
            @click="
              timelineStore.updateTrackProperties(props.track.id, {
                audioMuted: !props.track.audioMuted,
              })
            "
          />
          <UiToggleButton
            v-if="track.kind === 'audio' || track.kind === 'video'"
            :model-value="isSolo"
            icon="i-heroicons-musical-note"
            inactive-color="neutral"
            active-color="warning"
            :active-bg="'#fbbf24'"
            :active-text="'#000000'"
            title="Toggle solo"
            @click="isSolo = !isSolo"
          />
          <UiToggleButton
            :model-value="isLocked"
            icon="i-heroicons-lock-open"
            active-icon="i-heroicons-lock-closed"
            inactive-color="neutral"
            active-color="primary"
            :active-bg="'#3b82f6'"
            :active-text="'#ffffff'"
            title="Toggle lock"
            @click="isLocked = !isLocked"
          />
        </div>

        <div v-if="extraActions.length > 0" class="pt-1">
          <PropertyActionList :actions="extraActions" justify="start" size="sm" />
        </div>
      </div>
    </PropertySection>

    <PropertySection>
      <PropertyRow :label="t('fastcat.track.clipsCount')" :value="clipCount" />
    </PropertySection>

    <PropertySection :title="t('fastcat.track.color')">
      <UiColorPicker
        :model-value="trackColor"
        mode="track"
        @update:model-value="(v) => (trackColor = v)"
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

    <EffectsEditor
      v-if="track.kind === 'video'"
      :effects="trackVideoEffects"
      :title="`${t('fastcat.effects.tabs.video')} ${t('fastcat.effects.title').toLowerCase()}`"
      :add-label="t('fastcat.effects.add')"
      :empty-label="t('fastcat.effects.empty')"
      @update:effects="handleUpdateTrackEffects"
    />

    <AudioEffectsEditor
      v-if="track.kind === 'audio' || track.kind === 'video'"
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
  </div>
</template>
