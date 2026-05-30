<script setup lang="ts">
import { computed, toRef } from 'vue';
import ClipTransitionsSection from '~/components/properties/clip/ClipTransitionsSection.vue';
import ClipTransformSection from '~/components/properties/clip/ClipTransformSection.vue';
import ClipAudioSection from '~/components/properties/clip/ClipAudioSection.vue';
import MultiClipActionsSection from '~/components/properties/multi-clip/MultiClipActionsSection.vue';
import MultiClipBlendOpacitySection from '~/components/properties/multi-clip/MultiClipBlendOpacitySection.vue';
import MultiClipTimingSection from '~/components/properties/multi-clip/MultiClipTimingSection.vue';
import { useClipBatchActions } from '~/composables/timeline/useClipBatchActions';
import { useClipAudio } from '~/composables/properties/useClipAudio';
import { useTimelineStore } from '~/stores/timeline.store';
import { useMediaStore } from '~/stores/media.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useUiStore } from '~/stores/ui.store';
import { useAppClipboard } from '~/composables/useAppClipboard';
import { BLEND_MODE_OPTIONS as RAW_BLEND_MODE_OPTIONS } from '~/utils/constants';
import { DEFAULT_TRANSITION_CURVE, DEFAULT_TRANSITION_MODE } from '~/transitions';
import type {
  TimelineBlendMode,
  TimelineClipItem,
  ClipTransform,
  ClipSourceOrientation,
} from '~/timeline/types';

const props = defineProps<{
  items: { trackId: string; itemId: string }[];
}>();

const { t } = useI18n();

const timelineStore = useTimelineStore();
const mediaStore = useMediaStore();
const workspaceStore = useWorkspaceStore();
const selectionStore = useSelectionStore();
const uiStore = useUiStore();
const clipboardStore = useAppClipboard();

function handleCopyClips() {
  clipboardStore.setClipboardPayload({
    source: 'timeline',
    operation: 'copy',
    items: timelineStore.copySelectedClips().map((item) => ({
      sourceTrackId: item.sourceTrackId,
      clip: item.clip,
    })),
  });
}

function handleCutClips() {
  clipboardStore.setClipboardPayload({
    source: 'timeline',
    operation: 'cut',
    items: timelineStore.cutSelectedClips().map((item) => ({
      sourceTrackId: item.sourceTrackId,
      clip: item.clip,
    })),
  });
}

const itemsRef = toRef(props, 'items');
const {
  selectedClips,
  hasGroupedClip,
  hasFreeClip,
  allDisabled,
  allMuted,
  allLocked,
  isWaveformShown,
  isWaveformFull,
  isThumbnailsShown,
  hasAudioOrVideoWithAudio,
  hasVideo,
  hasVisual,
  hasSpeedControls,
  hasSourceOrientationControls,
  hasAutoMontageControls,
  firstVideoClip,
  firstWaveformClip,
  firstSpeedClip,
  firstSourceOrientationClip,
  audioClipRefs,
  visualClipRefs,
  speedClipRefs,
  sourceOrientationClipRefs,
  autoMontageClipRefs,
  handleGroupSelected,
  handleUngroupSelected,
  handleDelete,
  toggleDisabled,
  toggleMuted,
  toggleLocked,
  toggleShowWaveform,
  toggleWaveformMode,
  toggleShowThumbnails,
  handleSetUniformDuration,
  handleRelativeStartShift,
  handleRelativeEndShift,
  handleQuantizeSelected,
  handleBatchUpdateProperties,
} = useClipBatchActions(itemsRef, {
  timelineDoc: computed(() => timelineStore.timelineDoc),
  mediaMetadata: computed(() => mediaStore.mediaMetadata),
  batchApplyTimeline: (cmds) => timelineStore.batchApplyTimeline(cmds),
  clearSelection: () => timelineStore.clearSelection(),
});

const mediaMeta = computed(() => {
  if (!firstVideoClip.value) return null;
  if (firstVideoClip.value.clipType !== 'media' || !firstVideoClip.value.source?.path) return null;
  return mediaStore.mediaMetadata[firstVideoClip.value.source.path] || null;
});

const selectedCountLabel = computed(() => {
  return t('fastcat.timeline.selectedClipsCount', {
    count: props.items.length,
  });
});

const blendModeOptions = computed<Array<{ value: TimelineBlendMode; label: string }>>(() =>
  RAW_BLEND_MODE_OPTIONS.map((opt) => ({
    value: opt.value as TimelineBlendMode,
    label: t(opt.labelKey),
  })),
);

const startShiftAccumulator = ref(0);
const endShiftAccumulator = ref(0);
const durationShiftAccumulator = ref(0);

watch(itemsRef, () => {
  startShiftAccumulator.value = 0;
  endShiftAccumulator.value = 0;
  durationShiftAccumulator.value = 0;
});

function onStartShiftChange(newVal: number) {
  const deltaUs = newVal - startShiftAccumulator.value;
  handleRelativeStartShift(deltaUs);
  startShiftAccumulator.value = newVal;
}

function onEndShiftChange(newVal: number) {
  const deltaUs = newVal - endShiftAccumulator.value;
  // End shift logic using trim_item (which moves the end)
  handleRelativeEndShift(deltaUs);
  endShiftAccumulator.value = newVal;
}

function onDurationShiftChange(newVal: number) {
  const deltaUs = newVal - durationShiftAccumulator.value;
  handleRelativeEndShift(deltaUs);
  durationShiftAccumulator.value = newVal;
}

const firstClip = computed(() => selectedClips.value[0]);
const transformReferenceClip = computed(
  () => firstSourceOrientationClip.value ?? firstVideoClip.value,
);

const batchOpacity = computed({
  get: () => firstVideoClip.value?.opacity ?? 1,
  set: (val: number) =>
    handleBatchUpdateProperties(
      { opacity: val },
      visualClipRefs.value.map(({ track, clip }) => ({ trackId: track.id, itemId: clip.id })),
    ),
});

const batchBlendMode = computed({
  get: () => firstVideoClip.value?.blendMode ?? 'normal',
  set: (val: TimelineBlendMode) =>
    handleBatchUpdateProperties(
      { blendMode: val },
      visualClipRefs.value.map(({ track, clip }) => ({ trackId: track.id, itemId: clip.id })),
    ),
});

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
  updateAudioBalance,
  updateAudioFadeInCurve,
  updateAudioFadeInSec,
  updateAudioFadeOutCurve,
  updateAudioFadeOutSec,
  updateAudioGain,
} = useClipAudio({
  clip: computed(() => (firstWaveformClip.value || props.items[0]) as TimelineClipItem),
  tracks: computed(() => timelineStore.timelineDoc?.tracks),
  mediaMetadataByPath: computed(() => mediaStore.mediaMetadata),
  updateAudio: (patch) => {
    const cmds: import('~/timeline/commands').TimelineCommand[] = audioClipRefs.value.map(
      ({ track, clip }) => ({
        type: 'update_clip_properties',
        trackId: track.id,
        itemId: clip.id,
        properties: patch,
      }),
    );
    if (cmds.length > 0) {
      timelineStore.batchApplyTimeline(cmds);
    }
  },
});

function handleBatchToggleTransition(edge: 'in' | 'out') {
  const doc = timelineStore.timelineDoc;
  if (!doc || !firstVideoClip.value) return;

  const current =
    edge === 'in' ? firstVideoClip.value.transitionIn : firstVideoClip.value.transitionOut;

  const cmds: import('~/timeline/commands').TimelineCommand[] = [];

  if (current) {
    for (const { track, clip } of visualClipRefs.value) {
      cmds.push({
        type: 'update_clip_transition',
        trackId: track.id,
        itemId: clip.id,
        ...(edge === 'in' ? { transitionIn: null } : { transitionOut: null }),
      });
    }
  } else {
    const safeDefaultDurationUs = Math.max(
      0,
      Math.round(
        Number(workspaceStore.userSettings.timeline.defaultTransitionDurationUs ?? 1_000_000),
      ),
    );

    for (const { track, clip } of visualClipRefs.value) {
      const clipDurationUs = Math.max(0, Math.round(Number(clip.timelineRange?.durationUs ?? 0)));
      const suggestedDurationUs =
        clipDurationUs > 0 && clipDurationUs < safeDefaultDurationUs
          ? Math.round(clipDurationUs * 0.3)
          : safeDefaultDurationUs;

      const transition = {
        type: 'dissolve',
        durationUs: suggestedDurationUs,
        mode: DEFAULT_TRANSITION_MODE,
        curve: DEFAULT_TRANSITION_CURVE,
      };

      cmds.push({
        type: 'update_clip_transition',
        trackId: track.id,
        itemId: clip.id,
        ...(edge === 'in' ? { transitionIn: transition } : { transitionOut: transition }),
      });
    }
  }

  if (cmds.length > 0) {
    timelineStore.batchApplyTimeline(cmds);
  }
}

function handleBatchUpdateTransitionDuration(edge: 'in' | 'out', durationSec: number) {
  const doc = timelineStore.timelineDoc;
  if (!doc) return;
  const cmds: import('~/timeline/commands').TimelineCommand[] = [];
  const durationUs = Math.round(durationSec * 1_000_000);
  for (const { track, clip } of visualClipRefs.value) {
    const current = edge === 'in' ? clip.transitionIn : clip.transitionOut;
    if (!current) continue;

    cmds.push({
      type: 'update_clip_transition',
      trackId: track.id,
      itemId: clip.id,
      ...(edge === 'in'
        ? { transitionIn: { ...current, durationUs } }
        : { transitionOut: { ...current, durationUs } }),
    });
  }
  if (cmds.length > 0) timelineStore.batchApplyTimeline(cmds);
}

function handleBatchUpdateTransitionType(edge: 'in' | 'out', type: string) {
  const doc = timelineStore.timelineDoc;
  if (!doc) return;
  const cmds: import('~/timeline/commands').TimelineCommand[] = [];
  for (const { track, clip } of visualClipRefs.value) {
    const current = edge === 'in' ? clip.transitionIn : clip.transitionOut;
    if (!current) continue;

    cmds.push({
      type: 'update_clip_transition',
      trackId: track.id,
      itemId: clip.id,
      ...(edge === 'in'
        ? { transitionIn: { ...current, type } }
        : { transitionOut: { ...current, type } }),
    });
  }
  if (cmds.length > 0) timelineStore.batchApplyTimeline(cmds);
}

function handleBatchSelectTransitionEdge(edge: 'in' | 'out') {
  if (!firstVideoClip.value) return;
  const clip = firstVideoClip.value;
  timelineStore.selectTransition({ trackId: clip.trackId, itemId: clip.id, edge });
  selectionStore.selectTimelineTransition(clip.trackId, clip.id, edge);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function handleBatchTransform(next: ClipTransform) {
  const baseTransform = transformReferenceClip.value?.transform || {};

  const newAnchor = next.anchor;

  const nextScaleXSign = (next.scale?.x ?? 1) >= 0 ? 1 : -1;
  const nextScaleYSign = (next.scale?.y ?? 1) >= 0 ? 1 : -1;

  const baseScaleXMag = Math.abs(baseTransform.scale?.x ?? 1);
  const baseScaleYMag = Math.abs(baseTransform.scale?.y ?? 1);
  const nextScaleXMag = Math.abs(next.scale?.x ?? 1);
  const nextScaleYMag = Math.abs(next.scale?.y ?? 1);

  const deltaScaleXMag = nextScaleXMag - baseScaleXMag;
  const deltaScaleYMag = nextScaleYMag - baseScaleYMag;
  const nextLinked = next.scale?.linked ?? true;

  const deltaRot = (next.rotationDeg ?? 0) - (baseTransform.rotationDeg ?? 0);

  const deltaPosX = (next.position?.x ?? 0) - (baseTransform.position?.x ?? 0);
  const deltaPosY = (next.position?.y ?? 0) - (baseTransform.position?.y ?? 0);

  const deltaCropTop = (next.crop?.top ?? 0) - (baseTransform.crop?.top ?? 0);
  const deltaCropBottom = (next.crop?.bottom ?? 0) - (baseTransform.crop?.bottom ?? 0);
  const deltaCropLeft = (next.crop?.left ?? 0) - (baseTransform.crop?.left ?? 0);
  const deltaCropRight = (next.crop?.right ?? 0) - (baseTransform.crop?.right ?? 0);

  const doc = timelineStore.timelineDoc;
  if (!doc) return;

  const cmds: import('~/timeline/commands').TimelineCommand[] = [];

  for (const { track, clip } of visualClipRefs.value) {
    const curr = clip.transform || {};

    const currScaleXMag = Math.abs(curr.scale?.x ?? 1);
    const currScaleYMag = Math.abs(curr.scale?.y ?? 1);

    const newScaleX = nextScaleXSign * Math.abs(currScaleXMag + deltaScaleXMag);
    const newScaleY = nextScaleYSign * Math.abs(currScaleYMag + deltaScaleYMag);

    cmds.push({
      type: 'update_clip_properties',
      trackId: track.id,
      itemId: clip.id,
      properties: {
        transform: {
          ...curr,
          anchor: newAnchor,
          scale: {
            x: newScaleX,
            y: newScaleY,
            linked: nextLinked,
          },
          rotationDeg: (curr.rotationDeg ?? 0) + deltaRot,
          position: {
            x: (curr.position?.x ?? 0) + deltaPosX,
            y: (curr.position?.y ?? 0) + deltaPosY,
          },
          crop: {
            ...curr.crop,
            top: clampNumber((curr.crop?.top ?? 0) + deltaCropTop, 0, 100),
            bottom: clampNumber((curr.crop?.bottom ?? 0) + deltaCropBottom, 0, 100),
            left: clampNumber((curr.crop?.left ?? 0) + deltaCropLeft, 0, 100),
            right: clampNumber((curr.crop?.right ?? 0) + deltaCropRight, 0, 100),
          },
        },
      },
    });
  }

  if (cmds.length > 0) {
    timelineStore.batchApplyTimeline(cmds);
  }
}

function handleBatchUpdateSpeed(speed: number) {
  const doc = timelineStore.timelineDoc;
  if (!doc) return;
  const cmds: import('~/timeline/commands').TimelineCommand[] = [];
  for (const { track, clip } of speedClipRefs.value) {
    cmds.push({
      type: 'update_clip_properties',
      trackId: track.id,
      itemId: clip.id,
      properties: { speed },
    });
  }
  if (cmds.length > 0) timelineStore.batchApplyTimeline(cmds);
}

function handleBatchUpdateSourceOrientation(sourceOrientation: ClipSourceOrientation) {
  handleBatchUpdateProperties(
    { sourceOrientation },
    sourceOrientationClipRefs.value.map(({ track, clip }) => ({
      trackId: track.id,
      itemId: clip.id,
    })),
  );
}

function handleBatchToggleReversed() {
  const doc = timelineStore.timelineDoc;
  if (!doc) return;
  const cmds: import('~/timeline/commands').TimelineCommand[] = [];
  for (const { track, clip } of speedClipRefs.value) {
    const currentSpeed = typeof clip.speed === 'number' ? clip.speed : 1;
    cmds.push({
      type: 'update_clip_properties',
      trackId: track.id,
      itemId: clip.id,
      properties: { speed: -currentSpeed },
    });
  }
  if (cmds.length > 0) timelineStore.batchApplyTimeline(cmds);
}

const commonActions = computed(() => {
  const actions = [
    {
      id: 'copy',
      title: t('common.copy'),
      icon: 'i-heroicons-document-duplicate',
      onClick: handleCopyClips,
    },
    {
      id: 'cut',
      title: t('common.cut'),
      icon: 'i-heroicons-scissors',
      onClick: handleCutClips,
    },
    {
      id: 'delete',
      title: t('common.delete'),
      icon: 'i-heroicons-trash',
      onClick: handleDelete,
    },
    {
      id: 'toggle-disabled',
      title: allDisabled.value
        ? t('fastcat.timeline.enableClips')
        : t('fastcat.timeline.disableClips'),
      icon: allDisabled.value ? 'i-heroicons-eye' : 'i-heroicons-eye-slash',
      color: allDisabled.value ? 'warning' : 'neutral',
      variant: allDisabled.value ? 'solid' : 'ghost',
      onClick: toggleDisabled,
    },
    {
      id: 'toggle-locked',
      title: allLocked.value ? t('fastcat.timeline.unlockClips') : t('fastcat.timeline.lockClips'),
      icon: allLocked.value ? 'i-heroicons-lock-open' : 'i-heroicons-lock-closed',
      color: allLocked.value ? 'primary' : 'neutral',
      variant: allLocked.value ? 'solid' : 'ghost',
      onClick: toggleLocked,
    },
  ];

  if (hasAudioOrVideoWithAudio.value) {
    actions.push({
      id: 'toggle-muted',
      title: allMuted.value ? t('fastcat.timeline.unmuteClips') : t('fastcat.timeline.muteClips'),
      icon: allMuted.value ? 'i-heroicons-speaker-wave' : 'i-heroicons-speaker-x-mark',
      color: allMuted.value ? 'error' : 'neutral',
      variant: allMuted.value ? 'solid' : 'ghost',
      onClick: toggleMuted,
    });
  }

  return actions as import('~/components/properties/PropertyActionsBlock.vue').PropertyActionItem[];
});

const otherActions = computed(() => {
  const result: Array<{
    id: string;
    label: string;
    icon: string;
    hidden?: boolean;
    onClick: () => void;
  }> = [];

  result.push({
    id: 'group',
    label: t('fastcat.timeline.groupClips'),
    icon: 'i-heroicons-link',
    hidden: props.items.length < 2,
    onClick: handleGroupSelected,
  });

  result.push({
    id: 'ungroup',
    label: t('fastcat.timeline.ungroupClips'),
    icon: 'i-heroicons-link-slash',
    hidden: !hasGroupedClip.value,
    onClick: handleUngroupSelected,
  });

  if (hasFreeClip.value) {
    result.push({
      id: 'quantize',
      label: t('fastcat.timeline.quantize'),
      icon: 'i-heroicons-squares-2x2',
      onClick: handleQuantizeSelected,
    });
  }

  if (hasAutoMontageControls.value) {
    result.push({
      id: 'autoMontage',
      label: t('fastcat.timeline.autoMontage.title'),
      icon: 'i-heroicons-sparkles',
      onClick: () =>
        uiStore.triggerOpenAutoMontage(autoMontageClipRefs.value.map(({ clip }) => clip.id)),
    });
  }

  if (hasAudioOrVideoWithAudio.value) {
    result.push({
      id: 'toggle-waveform',
      label: isWaveformShown.value
        ? t('fastcat.timeline.hideWaveform')
        : t('fastcat.timeline.showWaveform'),
      icon: isWaveformShown.value ? 'i-heroicons-eye-slash' : 'i-heroicons-eye',
      onClick: toggleShowWaveform,
    });

    result.push({
      id: 'waveform-mode',
      label: isWaveformFull.value
        ? t('fastcat.timeline.showHalfWaveform')
        : t('fastcat.timeline.showFullWaveform'),
      icon: 'i-heroicons-chart-bar',
      onClick: toggleWaveformMode,
    });
  }

  if (hasVideo.value) {
    result.push({
      id: 'toggle-thumbnails',
      label: isThumbnailsShown.value
        ? t('fastcat.timeline.hideThumbnails')
        : t('fastcat.timeline.showThumbnails'),
      icon: isThumbnailsShown.value ? 'i-heroicons-eye-slash' : 'i-heroicons-eye',
      onClick: toggleShowThumbnails,
    });
  }

  return result as import('~/components/properties/PropertyActionsBlock.vue').PropertyActionItem[];
});
</script>

<template>
  <!-- IMPORTANT: NO LOADING INDICATORS ALLOWED HERE. ALL PROPERTIES MUST LOAD SILENTLY. -->
  <div class="flex flex-col gap-2 w-full text-ui-text">
    <MultiClipActionsSection
      :selected-count-label="selectedCountLabel"
      :common-actions="commonActions"
      :other-actions="otherActions"
    />

    <MultiClipTimingSection
      :first-clip="firstClip"
      :duration-shift-accumulator="durationShiftAccumulator"
      :start-shift-accumulator="startShiftAccumulator"
      :end-shift-accumulator="endShiftAccumulator"
      @set-uniform-duration="handleSetUniformDuration"
      @duration-shift-change="onDurationShiftChange"
      @start-shift-change="onStartShiftChange"
      @end-shift-change="onEndShiftChange"
    />

    <ClipTransitionsSection
      v-if="hasVisual && firstVideoClip"
      :is-video-track="true"
      :transition-in="firstVideoClip.transitionIn ?? null"
      :transition-out="firstVideoClip.transitionOut ?? null"
      :clip-duration-us="firstVideoClip.timelineRange.durationUs"
      @select-edge="handleBatchSelectTransitionEdge"
      @toggle="handleBatchToggleTransition"
      @update-duration="
        ({ edge, durationSec }) => handleBatchUpdateTransitionDuration(edge, durationSec)
      "
      @update-type="({ edge, type }) => handleBatchUpdateTransitionType(edge, type)"
    />

    <MultiClipBlendOpacitySection
      v-if="hasVisual"
      v-model:opacity="batchOpacity"
      v-model:blend-mode="batchBlendMode"
      :blend-mode-options="blendModeOptions"
    />

    <ClipAudioSection
      v-if="hasAudioOrVideoWithAudio && firstWaveformClip"
      :can-edit-audio-fades="canEditAudioFades"
      :can-edit-audio-balance="canEditAudioBalance"
      :can-edit-audio-gain="canEditAudioGain"
      :selected-track-kind="
        firstWaveformClip?.trackId
          ? (timelineStore.timelineDoc?.tracks.find((t) => t.id === firstWaveformClip?.trackId)
              ?.kind ?? null)
          : null
      "
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
      v-if="hasVisual && transformReferenceClip"
      :clip="transformReferenceClip"
      track-kind="video"
      :can-edit-reversed="hasSpeedControls"
      :is-reversed="typeof firstSpeedClip?.speed === 'number' && firstSpeedClip.speed < 0"
      :media-meta="mediaMeta"
      @update-transform="handleBatchTransform"
      @update-source-orientation="
        hasSourceOrientationControls ? handleBatchUpdateSourceOrientation($event) : undefined
      "
      @toggle-reversed="hasSpeedControls ? handleBatchToggleReversed() : undefined"
      @update-speed="handleBatchUpdateSpeed"
    />
  </div>
</template>
