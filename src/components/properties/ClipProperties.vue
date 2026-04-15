<script setup lang="ts">
import { computed, ref, watch, inject } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { useProjectTabsStore } from '~/stores/project-tabs.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useMediaStore } from '~/stores/media.store';
import { useUiStore } from '~/stores/ui.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useAppClipboard } from '~/composables/useAppClipboard';
import { useFocusStore } from '~/stores/focus.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import {
  useFileManagerStore,
  useFilesPageFileManagerStore,
  type FileManagerStore,
} from '~/stores/file-manager.store';
import { BLEND_MODE_OPTIONS as RAW_BLEND_MODE_OPTIONS } from '~/utils/constants';
import type {
  AudioClipEffect,
  TimelineBlendMode,
  TimelineClipItem,
  TimelineTrack,
  TrackKind,
  VideoClipEffect,
} from '~/timeline/types';
import UiRenameModal from '~/components/ui/UiRenameModal.vue';
import ClipAudioSection from '~/components/properties/clip/ClipAudioSection.vue';
import ClipTransitionsSection from '~/components/properties/clip/ClipTransitionsSection.vue';
import ClipActionsSection from '~/components/properties/clip/ClipActionsSection.vue';
import ClipInfoSection from '~/components/properties/clip/ClipInfoSection.vue';
import ClipEffectsSection from '~/components/properties/clip/ClipEffectsSection.vue';
import ClipBlendingModeSection from '~/components/properties/clip/ClipBlendingModeSection.vue';
import ClipOpacitySection from '~/components/properties/clip/ClipOpacitySection.vue';
import ClipTransformSection from '~/components/properties/clip/ClipTransformSection.vue';
import ClipTypeSection from '~/components/properties/clip/ClipTypeSection.vue';
import ClipSpeedSection from '~/components/properties/clip/ClipSpeedSection.vue';
import ClipMaskSection from '~/components/properties/clip/ClipMaskSection.vue';
import { useClipAudio } from '~/composables/properties/useClipAudio';
import { useClipTransitions } from '~/composables/properties/useClipTransitions';
import { useClipPropertiesActions } from '~/composables/properties/useClipPropertiesActions';
import { useClipTextProperties } from '~/composables/properties/useClipTextProperties';
import { useClipShapeProperties } from '~/composables/properties/useClipShapeProperties';
import { useClipHudProperties } from '~/composables/properties/useClipHudProperties';
import EffectsEditor from '~/components/effects/EffectsEditor.vue';
import AudioEffectsEditor from '~/components/effects/AudioEffectsEditor.vue';

const props = defineProps<{
  clip: TimelineClipItem;
  hideActions?: boolean;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();
const projectStore = useProjectStore();
const { setActiveTab } = useProjectTabsStore();
const mediaStore = useMediaStore();
const selectionStore = useSelectionStore();
const fileManager = useFileManager();
const uiStore = useUiStore();
const workspaceStore = useWorkspaceStore();
const focusStore = useFocusStore();
const fileManagerStore = inject('fileManagerStore', useFileManagerStore()) as any;
const filesPageStore = useFilesPageFileManagerStore();
const clipboardStore = useAppClipboard();

const { isMobile } = useDevice();

const isUiRenameModalOpen = ref(false);

const activeTab = ref('clip');

const tabs = computed(() => [
  {
    label: t('fastcat.clip.tabs.clip'),
    value: 'clip',
    icon: 'i-heroicons-film',
  },
  {
    label: t('fastcat.clip.tabs.video'),
    value: 'video',
    icon: 'i-heroicons-sparkles',
  },
  {
    label: t('fastcat.clip.tabs.audio'),
    value: 'audio',
    icon: 'i-heroicons-speaker-wave',
  },
]);

const isOpacityEnabled = computed({
  get: () => props.clip.opacityActive !== false,
  set: (val) =>
    timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, { opacityActive: val }),
});
const isBlendingEnabled = computed({
  get: () => props.clip.blendModeActive !== false,
  set: (val) =>
    timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, { blendModeActive: val }),
});
const isMaskEnabled = computed({
  get: () => props.clip.maskActive !== false,
  set: (val) =>
    timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, { maskActive: val }),
});
const isAudioFadesEnabled = computed({
  get: () => props.clip.audioFadesActive !== false,
  set: (val) =>
    timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, {
      audioFadesActive: val,
    }),
});
const isTransitionsEnabled = ref(true); // Transitions logic not explicitly requested to change
const isVideoEffectsEnabled = ref(true); // effects not explicitly requested
const isAudioEffectsEnabled = ref(true); // effects not explicitly requested
const isTransformEnabled = computed({
  get: () => props.clip.transformActive !== false,
  set: (val) =>
    timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, { transformActive: val }),
});
const isSpeedEnabled = computed({
  get: () => props.clip.speedActive !== false,
  set: (val) =>
    timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, { speedActive: val }),
});

const clipRef = computed(() => props.clip);

const clipTrack = computed<TimelineTrack | undefined>(() =>
  timelineStore.timelineDoc?.tracks.find((t) => t.id === props.clip.trackId),
);

const clipTrackKind = computed<TrackKind>(() => clipTrack.value?.kind ?? 'video');

const blendModeOptions = computed<Array<{ value: TimelineBlendMode; label: string }>>(() =>
  RAW_BLEND_MODE_OPTIONS.map((opt) => ({
    value: opt.value as TimelineBlendMode,
    label: t(opt.labelKey),
  })),
);

const isVideoTrack = computed(() => clipTrackKind.value === 'video');

function handleCopyClip() {
  clipboardStore.setClipboardPayload({
    source: 'timeline',
    operation: 'copy',
    items: timelineStore.copySelectedClips().map((item) => ({
      sourceTrackId: item.sourceTrackId,
      clip: item.clip,
    })),
  });
}

function handleCutClip() {
  clipboardStore.setClipboardPayload({
    source: 'timeline',
    operation: 'cut',
    items: timelineStore.cutSelectedClips().map((item) => ({
      sourceTrackId: item.sourceTrackId,
      clip: item.clip,
    })),
  });
}

const {
  isFreePosition,
  hasLockedLinkedAudio,
  isLockedLinkedAudioClip,
  isInLinkedGroup,
  handleDeleteClip,
  handleUnlinkAudio,
  handleQuantizeClip,
  handleRemoveFromGroup,
  toggleAudioWaveformMode,
  toggleShowWaveform,
  toggleShowThumbnails,
  handleSelectInFileManager,
  handleOpenNestedTimeline,
  goToLinkedAudio,
  goToLinkedVideo,
  linkedAudioClip,
  linkedVideoClip,
  isSoloed,
  toggleSolo,
  handleReplaceMedia,
} = useClipPropertiesActions({
  clip: clipRef,
  trackKind: clipTrackKind,
  timelineStore,
  projectStore,
  uiStore,
  fileManagerStore,
  selectionStore,
  focusStore,
  fileManager,
  setActiveTab,
});

const mediaMeta = computed(() => {
  if (props.clip.clipType !== 'media' || !props.clip.source?.path) return null;
  return mediaStore.mediaMetadata[props.clip.source.path] || null;
});

function handleUpdateStartTime(val: number) {
  const newStartUs = Math.max(0, Math.round(val));
  if (newStartUs === props.clip.timelineRange.startUs) return;
  timelineStore.applyTimeline({
    type: 'move_item',
    trackId: props.clip.trackId,
    itemId: props.clip.id,
    startUs: newStartUs,
  });
}

function handleUpdateEndTime(val: number) {
  const newEndUs = Math.max(0, Math.round(val));
  const currentEndUs = props.clip.timelineRange.startUs + props.clip.timelineRange.durationUs;
  if (newEndUs === currentEndUs) return;
  timelineStore.applyTimeline({
    type: 'trim_item',
    trackId: props.clip.trackId,
    itemId: props.clip.id,
    edge: 'end',
    deltaUs: newEndUs - currentEndUs,
  });
}

function handleUpdateDuration(val: number) {
  const newDurationUs = Math.max(1, Math.round(val));
  const currentDurationUs = props.clip.timelineRange.durationUs;
  if (newDurationUs === currentDurationUs) return;
  timelineStore.applyTimeline({
    type: 'trim_item',
    trackId: props.clip.trackId,
    itemId: props.clip.id,
    edge: 'end',
    deltaUs: newDurationUs - currentDurationUs,
  });
}

function handleUpdateOpacity(val: number) {
  const safe = typeof val === 'number' && Number.isFinite(val) ? val : 1;
  timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, { opacity: safe });
}

function handleUpdateBlendMode(val: TimelineBlendMode | string) {
  const safe =
    val === 'add' || val === 'multiply' || val === 'screen' || val === 'darken' || val === 'lighten'
      ? val
      : 'normal';
  timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, { blendMode: safe });
}

function handleUpdateMask(mask: any) {
  timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, { mask } as any);
}

function handleUpdateClipEffects(effects: VideoClipEffect[]) {
  const audioEffects = (clipRef.value?.effects ?? []).filter(
    (e): e is AudioClipEffect => e?.target === 'audio',
  );
  timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, {
    effects: [...effects, ...audioEffects] as (VideoClipEffect | AudioClipEffect)[],
  });
}

function handleUpdateClipAudioEffects(effects: AudioClipEffect[]) {
  const videoEffects = (clipRef.value?.effects ?? []).filter((e) => e?.target !== 'audio');
  timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, {
    effects: [...videoEffects, ...effects] as (VideoClipEffect | AudioClipEffect)[],
  });
}

function handleUpdateBackgroundColor(val: string) {
  if (props.clip.clipType !== 'background') return;
  const safe = val.trim().length > 0 ? val.trim() : '#000000';
  timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, {
    backgroundColor: safe,
  });
}

function handleToggleDisabled() {
  timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, {
    disabled: !props.clip.disabled,
  });
}

function handleToggleLocked() {
  timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, {
    locked: !props.clip.locked,
  });
}

function handleToggleMuted() {
  timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, {
    audioMuted: !props.clip.audioMuted,
  });
}

function handleFreezeFrame() {
  const playheadUs = timelineStore.currentTime;
  const clipStartUs = props.clip.timelineRange.startUs;
  const relativeUs = playheadUs - clipStartUs;
  const clampedUs = Math.max(0, Math.min(relativeUs, props.clip.timelineRange.durationUs));
  timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, {
    freezeFrameSourceUs: Math.round(clampedUs),
  });
}

function handleResetFreezeFrame() {
  timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, {
    freezeFrameSourceUs: undefined,
  });
}

async function handleExtractAudio() {
  await timelineStore.extractAudioToTrack({
    videoTrackId: props.clip.trackId,
    videoItemId: props.clip.id,
  });
  await timelineStore.requestTimelineSave({ immediate: true });
}

function handleReturnAudio() {
  if (props.clip.linkedVideoClipId) {
    timelineStore.returnAudioToVideo({ videoItemId: props.clip.linkedVideoClipId });
  } else {
    timelineStore.returnAudioToVideo({ videoItemId: props.clip.id });
  }
  timelineStore.requestTimelineSave({ immediate: true });
}

const { handleUpdateText, handleUpdateTextStyle } = useClipTextProperties({
  clip: clipRef,
  timelineStore,
});

const {
  handleUpdateShapeType,
  handleUpdateFillColor,
  handleUpdateStrokeColor,
  handleUpdateStrokeWidth,
  handleUpdateShapeConfig,
} = useClipShapeProperties({
  clip: clipRef,
  timelineStore,
});

const { hudManifest, hudControlValues, handleUpdateHudControl } = useClipHudProperties({
  clip: clipRef,
  timelineStore,
});

const canEditReversed = computed(() => {
  const clipType = props.clip.clipType;
  return clipType === 'media' || clipType === 'timeline';
});

const isReversed = computed(() => {
  return typeof props.clip.speed === 'number' && props.clip.speed < 0;
});

function toggleReversed() {
  const currentSpeed = typeof props.clip.speed === 'number' ? props.clip.speed : 1;
  timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, {
    speed: -currentSpeed,
  });
}

const {
  audioBalance,
  audioFadeInCurve,
  audioFadeInMaxSec,
  audioFadeInSec,
  audioFadeOutCurve,
  audioFadeOutMaxSec,
  audioFadeOutSec,
  audioGain,
  canEditAudioBalance,
  canEditAudioFades,
  canEditAudioGain,
  selectedClipTrack,
  updateAudioBalance,
  updateAudioFadeInCurve,
  updateAudioFadeInSec,
  updateAudioFadeOutCurve,
  updateAudioFadeOutSec,
  updateAudioGain,
} = useClipAudio({
  clip: clipRef,
  tracks: computed(() => timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined),
  mediaMetadataByPath: computed(() => mediaStore.mediaMetadata),
  updateAudio: (patch) => {
    timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, patch);
  },
});

const effectsSectionRef = ref<HTMLElement | null>(null);

const clipVideoEffects = computed(() =>
  (clipRef.value?.effects ?? []).filter(
    (effect): effect is VideoClipEffect => effect?.target !== 'audio',
  ),
);

const clipAudioEffects = computed(() =>
  (clipRef.value?.effects ?? []).filter(
    (effect): effect is AudioClipEffect => effect?.target === 'audio',
  ),
);

const canEditAudioEffects = computed(() => canEditAudioFades.value && canEditAudioGain.value);

const { selectTransitionEdge, toggleTransition, updateTransitionDuration, updateTransitionType } =
  useClipTransitions({
    clip: clipRef,
    defaultDurationUs: computed(() =>
      Math.max(
        0,
        Math.round(
          Number(workspaceStore.userSettings.timeline.defaultTransitionDurationUs ?? 1_000_000),
        ),
      ),
    ),
    selectTransition: timelineStore.selectTransition,
    selectTimelineTransition: selectionStore.selectTimelineTransition,
    updateClipTransition: timelineStore.updateClipTransition,
  });

watch(
  () => uiStore.scrollToEffectsTrigger,
  () => {
    if (!effectsSectionRef.value) return;
    effectsSectionRef.value.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
);

defineExpose({
  isUiRenameModalOpen,
  handleDeleteClip,
});
</script>

<template>
  <div class="w-full flex flex-col gap-2 text-ui-text">
    <ClipActionsSection
      v-if="!hideActions"
      :clip="clip"
      :track-kind="clipTrackKind"
      :is-free-position="isFreePosition"
      :has-locked-linked-audio="hasLockedLinkedAudio"
      :is-locked-linked-audio-clip="isLockedLinkedAudioClip"
      :is-in-linked-group="isInLinkedGroup"
      :can-show-waveform-toggle="canEditAudioGain"
      :can-show-thumbnails-toggle="canEditAudioGain"
      :linked-audio-clip="linkedAudioClip"
      :linked-video-clip="linkedVideoClip"
      :is-soloed="isSoloed"
      @rename="isUiRenameModalOpen = true"
      @copy="handleCopyClip"
      @cut="handleCutClip"
      @delete="handleDeleteClip"
      @quantize="handleQuantizeClip"
      @unlink-audio="handleUnlinkAudio"
      @remove-from-group="handleRemoveFromGroup"
      @show-in-file-manager="handleSelectInFileManager"
      @go-to-timeline="handleOpenNestedTimeline"
      @toggle-show-waveform="toggleShowWaveform"
      @toggle-show-thumbnails="toggleShowThumbnails"
      @toggle-audio-waveform-mode="toggleAudioWaveformMode"
      @go-to-linked-audio="goToLinkedAudio"
      @go-to-linked-video="goToLinkedVideo"
      @toggle-disabled="handleToggleDisabled"
      @toggle-locked="handleToggleLocked"
      @toggle-muted="handleToggleMuted"
      @toggle-solo="toggleSolo"
      @freeze-frame="handleFreezeFrame"
      @reset-freeze-frame="handleResetFreezeFrame"
      @extract-audio="handleExtractAudio"
      @return-audio="handleReturnAudio"
      @replace-media="handleReplaceMedia"
      @auto-montage="uiStore.triggerOpenAutoMontage([clip.id])"
    />

    <UTabs v-model="activeTab" :items="tabs" variant="link" :content="false" class="mb-2" />

    <!-- Tab: Clip -->
    <div v-if="activeTab === 'clip'" class="flex flex-col gap-2">
      <ClipInfoSection
        v-if="!isMobile"
        :clip="clip"
        :media-meta="mediaMeta"
        :show-source="false"
        @update-start-time="handleUpdateStartTime"
        @update-end-time="handleUpdateEndTime"
        @update-duration="handleUpdateDuration"
      />

      <ClipTypeSection
        :clip="clip"
        :hud-manifest="hudManifest"
        :hud-control-values="hudControlValues"
        @update-background-color="handleUpdateBackgroundColor"
        @update-text="handleUpdateText"
        @update-text-style="handleUpdateTextStyle"
        @update-shape-type="handleUpdateShapeType"
        @update-fill-color="handleUpdateFillColor"
        @update-stroke-color="handleUpdateStrokeColor"
        @update-stroke-width="handleUpdateStrokeWidth"
        @update-shape-config="handleUpdateShapeConfig"
        @update-hud-control="handleUpdateHudControl"
      />

      <ClipSpeedSection
        v-model:enabled="isSpeedEnabled"
        :clip="clip"
        :can-edit-reversed="canEditReversed"
        @update-speed="
          (speed: number) => timelineStore.updateClipProperties(clip.trackId, clip.id, { speed })
        "
      />

      <ClipTransformSection
        v-model:enabled="isTransformEnabled"
        :clip="clip"
        :track-kind="clipTrackKind"
        :can-edit-reversed="canEditReversed"
        :is-reversed="isReversed"
        :media-meta="mediaMeta"
        @update-transform="
          (next) => timelineStore.updateClipProperties(clip.trackId, clip.id, { transform: next })
        "
        @toggle-reversed="toggleReversed"
      />

      <ClipInfoSection :clip="clip" :media-meta="mediaMeta" :show-info="false" />
    </div>

    <!-- Tab: Video -->
    <div v-else-if="activeTab === 'video'" class="flex flex-col gap-2">
      <ClipBlendingModeSection
        v-model:enabled="isBlendingEnabled"
        :clip-type="clip.clipType"
        :blend-mode="(clip.blendMode ?? 'normal') as TimelineBlendMode"
        :blend-mode-options="blendModeOptions"
        @update-blend-mode="handleUpdateBlendMode"
      />

      <ClipOpacitySection
        v-model:enabled="isOpacityEnabled"
        :clip-type="clip.clipType"
        :opacity="clip.opacity ?? 1"
        @update-opacity="handleUpdateOpacity"
      />

      <ClipMaskSection
        v-if="isVideoTrack"
        v-model:enabled="isMaskEnabled"
        :clip="clip"
        @update-mask="handleUpdateMask"
      />

      <ClipTransitionsSection
        v-model:enabled="isTransitionsEnabled"
        :is-video-track="isVideoTrack"
        :transition-in="clip.transitionIn ?? null"
        :transition-out="clip.transitionOut ?? null"
        :clip-duration-us="clip.timelineRange.durationUs"
        @select-edge="selectTransitionEdge"
        @toggle="toggleTransition"
        @update-duration="({ edge, durationSec }) => updateTransitionDuration(edge, durationSec)"
        @update-type="({ edge, type }) => updateTransitionType(edge, type)"
      />

      <div ref="effectsSectionRef">
        <EffectsEditor
          v-model:toggle-value="isVideoEffectsEnabled"
          :effects="clipVideoEffects"
          :title="t('fastcat.effects.videoTitle')"
          :add-label="t('fastcat.effects.add')"
          :empty-label="t('fastcat.effects.empty')"
          :has-toggle="true"
          :disabled="!isVideoEffectsEnabled"
          @update:effects="handleUpdateClipEffects"
        />
      </div>
    </div>

    <!-- Tab: Audio -->
    <div v-else-if="activeTab === 'audio'" class="flex flex-col gap-2">
      <ClipAudioSection
        v-model:enabled="isAudioFadesEnabled"
        :can-edit-audio-fades="canEditAudioFades"
        :can-edit-audio-balance="canEditAudioBalance"
        :can-edit-audio-gain="canEditAudioGain"
        :selected-track-kind="selectedClipTrack?.kind ?? null"
        :audio-gain="audioGain"
        :audio-balance="audioBalance"
        :audio-fade-in-sec="audioFadeInSec"
        :audio-fade-out-sec="audioFadeOutSec"
        :audio-fade-in-max-sec="audioFadeInMaxSec"
        :audio-fade-out-max-sec="audioFadeOutMaxSec"
        :audio-fade-in-curve="audioFadeInCurve"
        :audio-fade-out-curve="audioFadeOutCurve"
        @update-audio-gain="updateAudioGain"
        @update-audio-balance="updateAudioBalance"
        @update-audio-fade-in-curve="updateAudioFadeInCurve"
        @update-audio-fade-in-sec="updateAudioFadeInSec"
        @update-audio-fade-out-curve="updateAudioFadeOutCurve"
        @update-audio-fade-out-sec="updateAudioFadeOutSec"
      />

      <AudioEffectsEditor
        v-if="canEditAudioEffects"
        v-model:toggle-value="isAudioEffectsEnabled"
        :effects="clipAudioEffects"
        :has-toggle="true"
        :disabled="!isAudioEffectsEnabled"
        @update:effects="handleUpdateClipAudioEffects"
      />
    </div>

    <UiRenameModal
      :open="isUiRenameModalOpen"
      :current-name="clip.name"
      :title="t('fastcat.clip.rename')"
      @update:open="isUiRenameModalOpen = $event"
      @rename="
        (name) => {
          timelineStore.renameItem(clip.trackId, clip.id, name);
          isUiRenameModalOpen = false;
        }
      "
    />
  </div>
</template>

<style scoped>
:deep([data-state='active']) {
  color: var(--selection-accent-400) !important;
}
</style>
