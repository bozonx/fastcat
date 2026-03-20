<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { useProjectTabsStore } from '~/stores/tabs.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useMediaStore } from '~/stores/media.store';
import { useUiStore } from '~/stores/ui.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useEditorViewStore } from '~/stores/editorView.store';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import { useFilesPageStore } from '~/stores/filesPage.store';
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
import ClipTransformSection from '~/components/properties/clip/ClipTransformSection.vue';
import ClipTypeSection from '~/components/properties/clip/ClipTypeSection.vue';
import { useClipAudio } from '~/composables/properties/useClipAudio';
import { useClipTransitions } from '~/composables/properties/useClipTransitions';
import { useClipPropertiesActions } from '~/composables/properties/useClipPropertiesActions';
import { useClipTextProperties } from '~/composables/properties/useClipTextProperties';
import { useClipShapeProperties } from '~/composables/properties/useClipShapeProperties';
import { useClipHudProperties } from '~/composables/properties/useClipHudProperties';

const props = defineProps<{
  clip: TimelineClipItem;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();
const projectStore = useProjectStore();
const { setActiveTab } = useProjectTabsStore();
const mediaStore = useMediaStore();
const selectionStore = useSelectionStore();
const editorViewStore = useEditorViewStore();
const fileManager = useFileManager();
const uiStore = useUiStore();
const workspaceStore = useWorkspaceStore();
const focusStore = useFocusStore();
const filesPageStore = useFilesPageStore();

const isUiRenameModalOpen = ref(false);

const clipRef = computed(() => props.clip);

const clipTrack = computed<TimelineTrack | undefined>(() =>
  timelineStore.timelineDoc?.tracks.find((t) => t.id === props.clip.trackId),
);

const clipTrackKind = computed<TrackKind>(() => clipTrack.value?.kind ?? 'video');

const blendModeOptions = computed<Array<{ value: TimelineBlendMode; label: string }>>(() => [
  { value: 'normal', label: t('fastcat.clip.blendMode.normal') },
  { value: 'add', label: t('fastcat.clip.blendMode.add') },
  { value: 'multiply', label: t('fastcat.clip.blendMode.multiply') },
  { value: 'screen', label: t('fastcat.clip.blendMode.screen') },
  { value: 'darken', label: t('fastcat.clip.blendMode.darken') },
  { value: 'lighten', label: t('fastcat.clip.blendMode.lighten') },
]);

const isVideoTrack = computed(() => clipTrackKind.value === 'video');

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
} = useClipPropertiesActions({
  clip: clipRef,
  trackKind: clipTrackKind,
  timelineStore,
  projectStore,
  uiStore,
  editorViewStore,
  filesPageStore,
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
      :clip="clip"
      :track-kind="clipTrackKind"
      :is-free-position="isFreePosition"
      :has-locked-linked-audio="hasLockedLinkedAudio"
      :is-locked-linked-audio-clip="isLockedLinkedAudioClip"
      :is-in-linked-group="isInLinkedGroup"
      :can-show-waveform-toggle="canEditAudioGain"
      :can-show-thumbnails-toggle="canEditAudioGain"
      @rename="isUiRenameModalOpen = true"
      @delete="handleDeleteClip"
      @quantize="handleQuantizeClip"
      @unlink-audio="handleUnlinkAudio"
      @remove-from-group="handleRemoveFromGroup"
      @show-in-file-manager="handleSelectInFileManager"
      @go-to-timeline="handleOpenNestedTimeline"
      @toggle-show-waveform="toggleShowWaveform"
      @toggle-show-thumbnails="toggleShowThumbnails"
      @toggle-audio-waveform-mode="toggleAudioWaveformMode"
    />

    <ClipInfoSection
      :clip="clip"
      :media-meta="mediaMeta"
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

    <ClipTransitionsSection
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
      <ClipEffectsSection
        :clip-type="clip.clipType"
        :opacity="clip.opacity ?? 1"
        :blend-mode="(clip.blendMode ?? 'normal') as TimelineBlendMode"
        :video-effects="clipVideoEffects"
        :audio-effects="clipAudioEffects"
        :can-edit-audio-effects="canEditAudioEffects"
        :blend-mode-options="blendModeOptions"
        @update-opacity="handleUpdateOpacity"
        @update-blend-mode="handleUpdateBlendMode"
        @update-video-effects="handleUpdateClipEffects"
        @update-audio-effects="handleUpdateClipAudioEffects"
      />
    </div>

    <ClipAudioSection
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

    <ClipTransformSection
      :clip="clip"
      :track-kind="clipTrackKind"
      :can-edit-reversed="canEditReversed"
      :is-reversed="isReversed"
      @update-transform="
        (next) => timelineStore.updateClipProperties(clip.trackId, clip.id, { transform: next })
      "
      @toggle-reversed="toggleReversed"
    />

    <UiRenameModal
      :open="isUiRenameModalOpen"
      :current-name="clip.name"
      :title="t('fastcat.clip.rename', 'Rename clip')"
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
