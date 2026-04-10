<script setup lang="ts">
import { computed, toRef } from 'vue';
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyTimecode from '~/components/properties/PropertyTimecode.vue';
import PropertyField from '~/components/properties/PropertyField.vue';
import PropertyActionList from '~/components/properties/PropertyActionList.vue';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';
import UiSliderInput from '~/components/ui/UiSliderInput.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
import UiTimecode from '~/components/ui/editor/UiTimecode.vue';
import ClipTransitionsSection from '~/components/properties/clip/ClipTransitionsSection.vue';
import ClipTransformSection from '~/components/properties/clip/ClipTransformSection.vue';
import ClipAudioSection from '~/components/properties/clip/ClipAudioSection.vue';
import { useClipBatchActions } from '~/composables/timeline/useClipBatchActions';
import { useClipAudio } from '~/composables/properties/useClipAudio';
import { useTimelineStore } from '~/stores/timeline.store';
import { useMediaStore } from '~/stores/media.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useAppClipboard } from '~/composables/useAppClipboard';
import { BLEND_MODE_OPTIONS as RAW_BLEND_MODE_OPTIONS } from '~/utils/constants';
import { DEFAULT_TRANSITION_CURVE, DEFAULT_TRANSITION_MODE } from '~/transitions';
import type { TimelineBlendMode, TimelineClipItem, ClipTransform } from '~/timeline/types';

const props = defineProps<{
  items: { trackId: string; itemId: string }[];
}>();

const { t } = useI18n();

const timelineStore = useTimelineStore();
const mediaStore = useMediaStore();
const workspaceStore = useWorkspaceStore();
const selectionStore = useSelectionStore();
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
  hasLockedLinks,
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
  hasVideoOrImage,
  firstVideoClip,
  firstWaveformClip,
  handleUnlinkSelected,
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

const batchOpacity = computed({
  get: () => firstClip.value?.opacity ?? 1,
  set: (val: number) => handleBatchUpdateProperties({ opacity: val }),
});

const batchBlendMode = computed({
  get: () => firstClip.value?.blendMode ?? 'normal',
  set: (val: TimelineBlendMode) => handleBatchUpdateProperties({ blendMode: val }),
});

const batchAudioGain = computed({
  get: () => Number(firstClip.value?.audioGain ?? 0),
  set: (val: number) => handleBatchUpdateProperties({ audioGain: val }),
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
  clip: computed(() => (firstWaveformClip.value || props.items[0]) as any),
  tracks: computed(() => timelineStore.timelineDoc?.tracks),
  mediaMetadataByPath: computed(() => mediaStore.mediaMetadata),
  updateAudio: (patch) => {
    const doc = timelineStore.timelineDoc;
    if (!doc) return;
    const cmds: any[] = [];
    for (const { trackId, itemId } of props.items) {
      const track = doc.tracks.find((t) => t.id === trackId);
      const clip = track?.items.find((it) => it.id === itemId);
      if (!track || !clip || clip.kind !== 'clip') continue;

      const isAudioTrack = track.kind === 'audio';
      const isVideoWithAudio =
        track.kind === 'video' &&
        clip.clipType === 'media' &&
        (Boolean((clip as any).linkedVideoClipId) ||
          Boolean(mediaStore.mediaMetadata[clip.source?.path ?? '']?.audio));

      if (isAudioTrack || isVideoWithAudio) {
        cmds.push({
          type: 'update_clip_properties',
          trackId,
          itemId,
          properties: patch,
        });
      }
    }
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

  const cmds: any[] = [];

  if (current) {
    for (const { trackId, itemId } of props.items) {
      const track = doc.tracks.find((t) => t.id === trackId);
      if (!track || track.kind === 'audio') continue;
      cmds.push({
        type: 'update_clip_transition',
        trackId,
        itemId,
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

    for (const { trackId, itemId } of props.items) {
      const track = doc.tracks.find((t) => t.id === trackId);
      if (!track || track.kind === 'audio') continue;
      const clip = track.items.find((it) => it.id === itemId) as TimelineClipItem;
      if (!clip || clip.kind !== 'clip') continue;

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
        trackId,
        itemId,
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
  const cmds: any[] = [];
  const durationUs = Math.round(durationSec * 1_000_000);
  for (const { trackId, itemId } of props.items) {
    const track = doc.tracks.find((t) => t.id === trackId);
    if (!track || track.kind === 'audio') continue;
    const clip = track.items.find((it) => it.id === itemId) as TimelineClipItem;
    if (!clip || clip.kind !== 'clip') continue;

    const current = edge === 'in' ? (clip as any).transitionIn : (clip as any).transitionOut;
    if (!current) continue;

    cmds.push({
      type: 'update_clip_transition',
      trackId,
      itemId,
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
  const cmds: any[] = [];
  for (const { trackId, itemId } of props.items) {
    const track = doc.tracks.find((t) => t.id === trackId);
    if (!track || track.kind === 'audio') continue;
    const clip = track.items.find((it) => it.id === itemId) as TimelineClipItem;
    if (!clip || clip.kind !== 'clip') continue;

    const current = edge === 'in' ? (clip as any).transitionIn : (clip as any).transitionOut;
    if (!current) continue;

    cmds.push({
      type: 'update_clip_transition',
      trackId,
      itemId,
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
  const baseTransform = firstVideoClip.value?.transform || {};

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

  const cmds: any[] = [];

  for (const { trackId, itemId } of props.items) {
    const track = doc.tracks.find((t) => t.id === trackId);
    if (!track || track.kind !== 'video') continue;
    const clip = track.items.find((it) => it.id === itemId) as TimelineClipItem;
    if (!clip || clip.kind !== 'clip') continue;

    const curr = clip.transform || {};

    const currScaleXMag = Math.abs(curr.scale?.x ?? 1);
    const currScaleYMag = Math.abs(curr.scale?.y ?? 1);

    const newScaleX = nextScaleXSign * Math.abs(currScaleXMag + deltaScaleXMag);
    const newScaleY = nextScaleYSign * Math.abs(currScaleYMag + deltaScaleYMag);

    cmds.push({
      type: 'update_clip_properties',
      trackId,
      itemId,
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
  const cmds: any[] = [];
  for (const { trackId, itemId } of props.items) {
    const track = doc.tracks.find((t) => t.id === trackId);
    if (!track || track.kind !== 'video') continue;
    cmds.push({
      type: 'update_clip_properties',
      trackId,
      itemId,
      properties: { speed },
    });
  }
  if (cmds.length > 0) timelineStore.batchApplyTimeline(cmds);
}

function handleBatchToggleReversed() {
  const doc = timelineStore.timelineDoc;
  if (!doc) return;
  const cmds: any[] = [];
  for (const { trackId, itemId } of props.items) {
    const track = doc.tracks.find((t) => t.id === trackId);
    if (!track || track.kind !== 'video') continue;
    const clip = track.items.find((it) => it.id === itemId) as TimelineClipItem;
    if (!clip || clip.kind !== 'clip') continue;
    const currentSpeed = typeof clip.speed === 'number' ? clip.speed : 1;
    cmds.push({
      type: 'update_clip_properties',
      trackId,
      itemId,
      properties: { speed: -currentSpeed },
    });
  }
  if (cmds.length > 0) timelineStore.batchApplyTimeline(cmds);
}

const commonActions = computed(() => {
  const actions = [
    {
      id: 'copy',
      title: t('common.copy', 'Copy'),
      icon: 'i-heroicons-document-duplicate',
      onClick: handleCopyClips,
    },
    {
      id: 'cut',
      title: t('common.cut', 'Cut'),
      icon: 'i-heroicons-scissors',
      onClick: handleCutClips,
    },
    {
      id: 'delete',
      title: t('common.delete', 'Delete'),
      icon: 'i-heroicons-trash',
      onClick: handleDelete,
    },
    {
      id: 'toggle-disabled',
      title: allDisabled.value
        ? t('fastcat.timeline.enableClips', 'Enable clips')
        : t('fastcat.timeline.disableClips', 'Disable clips'),
      icon: allDisabled.value ? 'i-heroicons-eye' : 'i-heroicons-eye-slash',
      onClick: toggleDisabled,
    },
    {
      id: 'toggle-locked',
      title: allLocked.value
        ? t('fastcat.timeline.unlockClips', 'Unlock clips')
        : t('fastcat.timeline.lockClips', 'Lock clips'),
      icon: allLocked.value ? 'i-heroicons-lock-open' : 'i-heroicons-lock-closed',
      onClick: toggleLocked,
    },
  ];

  if (hasAudioOrVideoWithAudio.value) {
    actions.push({
      id: 'toggle-muted',
      title: allMuted.value
        ? t('fastcat.timeline.unmuteClips', 'Unmute clips')
        : t('fastcat.timeline.muteClips', 'Mute clips'),
      icon: allMuted.value ? 'i-heroicons-speaker-wave' : 'i-heroicons-speaker-x-mark',
      onClick: toggleMuted,
    });
  }

  return actions;
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
    label: t('fastcat.timeline.groupClips', 'Group clips'),
    icon: 'i-heroicons-link',
    hidden: props.items.length < 2,
    onClick: handleGroupSelected,
  });

  result.push({
    id: 'ungroup',
    label: t('fastcat.timeline.ungroupClips', 'Ungroup clips'),
    icon: 'i-heroicons-link-slash',
    hidden: !hasGroupedClip.value,
    onClick: handleUngroupSelected,
  });

  if (hasFreeClip.value) {
    result.push({
      id: 'quantize',
      label: t('fastcat.timeline.quantize', 'Quantize to frames'),
      icon: 'i-heroicons-squares-2x2',
      onClick: handleQuantizeSelected,
    });
  }

  if (hasLockedLinks.value) {
    result.push({
      id: 'unlink-audio',
      label: t('fastcat.timeline.unlinkAudio', 'Unlink audio'),
      icon: 'i-heroicons-link-slash',
      onClick: handleUnlinkSelected,
    });
  }

  if (hasAudioOrVideoWithAudio.value) {
    result.push({
      id: 'toggle-waveform',
      label: isWaveformShown.value
        ? t('fastcat.timeline.hideWaveform', 'Hide Waveform')
        : t('fastcat.timeline.showWaveform', 'Show Waveform'),
      icon: isWaveformShown.value ? 'i-heroicons-eye-slash' : 'i-heroicons-eye',
      onClick: toggleShowWaveform,
    });

    result.push({
      id: 'waveform-mode',
      label: isWaveformFull.value
        ? t('fastcat.timeline.waveformHalf', 'Waveform: Half')
        : t('fastcat.timeline.waveformFull', 'Waveform: Full'),
      icon: 'i-heroicons-chart-bar',
      onClick: toggleWaveformMode,
    });
  }

  if (hasVideo.value) {
    result.push({
      id: 'toggle-thumbnails',
      label: isThumbnailsShown.value
        ? t('fastcat.timeline.hideThumbnails', 'Hide Thumbnails')
        : t('fastcat.timeline.showThumbnails', 'Show Thumbnails'),
      icon: isThumbnailsShown.value ? 'i-heroicons-eye-slash' : 'i-heroicons-eye',
      onClick: toggleShowThumbnails,
    });
  }

  return result;
});
</script>

<template>
  <!-- IMPORTANT: NO LOADING INDICATORS ALLOWED HERE. ALL PROPERTIES MUST LOAD SILENTLY. -->
  <div class="flex flex-col gap-2 w-full text-ui-text">

    <PropertySection :title="t('fastcat.clip.actions', 'Actions')">
      <div class="flex flex-col w-full px-3 pb-3">
        <span class="text-sm text-ui-text-muted mb-2">
          {{ selectedCountLabel }}
        </span>

        <PropertyActionList
          :actions="commonActions"
          :vertical="false"
          justify="start"
          variant="ghost"
          size="xs"
          class="mb-2"
        />

        <PropertyActionList :actions="otherActions" justify="start" size="xs" />
      </div>
    </PropertySection>

    <PropertySection :title="t('fastcat.clip.info', 'Clip Info')">
      <PropertyTimecode
        :label="t('common.duration', 'Duration')"
        :model-value="firstClip?.timelineRange.durationUs ?? 0"
        @update:model-value="handleSetUniformDuration"
      />

      <PropertyField :label="t('fastcat.timeline.durationShift', 'Duration Shift')" class="mt-2">
        <UiTimecode
          :model-value="durationShiftAccumulator"
          allow-negative
          @update:model-value="onDurationShiftChange"
        />
      </PropertyField>

      <PropertyField :label="t('fastcat.timeline.startShift', 'Start Shift')" class="mt-2">
        <UiTimecode
          :model-value="startShiftAccumulator"
          allow-negative
          @update:model-value="onStartShiftChange"
        />
      </PropertyField>

      <PropertyField :label="t('fastcat.timeline.endShift', 'End Shift')" class="mt-2">
        <UiTimecode
          :model-value="endShiftAccumulator"
          allow-negative
          @update:model-value="onEndShiftChange"
        />
      </PropertyField>
    </PropertySection>

    <ClipTransitionsSection
      v-if="hasVideoOrImage && firstVideoClip"
      :is-video-track="true"
      :transition-in="(firstVideoClip as any).transitionIn ?? null"
      :transition-out="(firstVideoClip as any).transitionOut ?? null"
      :clip-duration-us="firstVideoClip.timelineRange.durationUs"
      @select-edge="handleBatchSelectTransitionEdge"
      @toggle="handleBatchToggleTransition"
      @update-duration="
        ({ edge, durationSec }) => handleBatchUpdateTransitionDuration(edge, durationSec)
      "
      @update-type="({ edge, type }) => handleBatchUpdateTransitionType(edge, type)"
    />

    <div
      v-if="hasVideoOrImage"
      class="space-y-1.5 bg-ui-bg-elevated p-2 rounded border border-ui-border"
    >
      <div class="flex flex-col gap-0.5">
        <span class="text-xs text-ui-text-muted">{{
          t('fastcat.clip.blendMode.title', 'Blend Mode')
        }}</span>
        <UiSelect
          v-model="batchBlendMode"
          :items="blendModeOptions"
          value-key="value"
          label-key="label"
          size="sm"
        />
      </div>

      <UiSliderInput
        :label="t('fastcat.clip.opacity', 'Opacity')"
        unit="%"
        :model-value="batchOpacity"
        :min="0"
        :max="1"
        :step="0.01"
        :default-value="1"
        :wheel-step-multiplier="10"
        @update:model-value="batchOpacity = $event"
      />
    </div>

    <ClipAudioSection
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
      v-if="hasVideoOrImage && firstVideoClip"
      :clip="firstVideoClip"
      track-kind="video"
      :can-edit-reversed="
        firstVideoClip.clipType === 'media' || firstVideoClip.clipType === 'timeline'
      "
      :is-reversed="typeof firstVideoClip.speed === 'number' && firstVideoClip.speed < 0"
      :media-meta="mediaMeta"
      @update-transform="handleBatchTransform"
      @toggle-reversed="handleBatchToggleReversed"
      @update-speed="handleBatchUpdateSpeed"
    />
  </div>
</template>
