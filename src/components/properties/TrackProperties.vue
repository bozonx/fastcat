<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { blendModeOptions as rawBlendModeOptions } from '~/utils/constants';
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
import UiFormSectionHeader from '~/components/ui/UiFormSectionHeader.vue';
import PropertyRow from '~/components/properties/PropertyRow.vue';
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
    props.track.kind === 'video' ? props.track.videoHidden : (props.track.audioMuted ?? false),
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
      onClick: () => (isGenerateCaptionsOpen.value = true),
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
    <PropertySection :title="t('fastcat.track.actions', 'Actions')">
      <div class="flex flex-col w-full gap-3">
        <!-- Direct Actions Row (Matched with Header style) -->
        <div class="flex items-center gap-1.5 py-1">
          <UiToggleButton
            v-if="track.kind === 'video'"
            :model-value="props.track.videoHidden || false"
            icon="i-heroicons-eye"
            active-icon="i-heroicons-eye-slash"
            inactive-color="neutral"
            active-color="warning"
            :active-bg="'#facc15'"
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
            active-variant="soft"
            title="Toggle lock"
            @click="isLocked = !isLocked"
          />

          <div class="h-4 w-px bg-ui-border mx-1 opacity-50" />

          <div class="flex items-center gap-1">
            <UiActionButton
              icon="i-heroicons-pencil"
              size="sm"
              color="neutral"
              :title="t('common.rename', 'Rename')"
              @click="timelineStore.renamingTrackId = props.track.id"
            />
            <UiActionButton
              icon="i-heroicons-trash"
              size="sm"
              color="error"
              :title="t('common.delete', 'Delete')"
              @click="requestDeleteTrack"
            />
          </div>
        </div>

        <div v-if="extraActions.length > 0" class="pt-1">
          <PropertyActionList :actions="extraActions" justify="start" size="xs" />
        </div>
      </div>
    </PropertySection>

    <PropertySection :title="t('fastcat.track.info', 'Track Information')">
      <PropertyRow :label="t('fastcat.track.clipsCount', 'Clips count')" :value="clipCount" />
    </PropertySection>

    <PropertySection :title="t('common.properties', 'Properties')">
      <div class="flex flex-col w-full gap-4 py-1">
        <!-- Color Selection (Shared) -->
        <div class="flex flex-col gap-2">
          <UiFormSectionHeader :title="t('fastcat.track.color', 'Color')" />
          <UiColorPicker
            :model-value="trackColor"
            mode="track"
            @update:model-value="(v) => (trackColor = v)"
          />
        </div>

        <div class="h-px bg-ui-border opacity-30 my-1" />

        <!-- Track Composition & Media Settings -->
        <div class="flex flex-col gap-4">
          <div v-if="track.kind === 'video'" class="flex flex-col gap-3">
            <div class="flex flex-col gap-1">
              <span class="text-xs text-ui-text-muted font-medium">{{
                t('fastcat.track.blendMode', 'Blend mode')
              }}</span>
              <UiSelect
                :model-value="trackBlendMode"
                :items="blendModeOptions"
                value-key="value"
                label-key="label"
                size="sm"
                @update:model-value="
                  (v: unknown) =>
                    (trackBlendMode =
                      (v as { value: TimelineBlendMode })?.value ?? (v as TimelineBlendMode))
                "
              />
            </div>

            <UiSliderInput
              v-model="trackOpacity"
              :label="t('fastcat.track.opacity', 'Opacity')"
              unit="%"
              :min="0"
              :max="1"
              :step="0.01"
              :default-value="1"
            />

            <div class="h-px bg-ui-border opacity-30 my-1" />
          </div>

          <div v-if="track.kind === 'audio' || track.kind === 'video'" class="flex flex-col gap-3">
            <UiSliderInput
              v-model="trackAudioGain"
              :label="t('fastcat.track.audio.volume', 'Volume')"
              :min="0"
              :max="2"
              :step="0.001"
              :wheel-step-multiplier="10"
              :default-value="1"
              unit="x"
            />

            <UiSliderInput
              v-model="trackAudioBalance"
              :label="t('fastcat.track.audio.balance', 'Balance')"
              :min="-1"
              :max="1"
              :step="0.01"
              :default-value="0"
            />
          </div>
        </div>
      </div>
    </PropertySection>

    <EffectsEditor
      v-if="track.kind === 'video'"
      :effects="trackVideoEffects"
      :title="`${t('fastcat.effects.tabs.video')} ${t('fastcat.effects.title').toLowerCase()}`"
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
