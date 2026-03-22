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
import { useClipBatchActions } from '~/composables/timeline/useClipBatchActions';
import { useTimelineStore } from '~/stores/timeline.store';
import { useMediaStore } from '~/stores/media.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useAppClipboard } from '~/composables/useAppClipboard';
import { blendModeOptions as rawBlendModeOptions } from '~/utils/constants';
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

const selectedCountLabel = computed(() => {
  return t('fastcat.timeline.selectedClipsCount', {
    count: props.items.length,
  });
});

const blendModeOptions = computed<Array<{ value: TimelineBlendMode; label: string }>>(() =>
  rawBlendModeOptions.map((opt) => ({
    value: opt.value as TimelineBlendMode,
    label: t(opt.labelKey),
  })),
);

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
        patch: edge === 'in' ? { transitionIn: null } : { transitionOut: null },
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
        patch: edge === 'in' ? { transitionIn: transition } : { transitionOut: transition },
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
      patch:
        edge === 'in'
          ? { transitionIn: { ...current, durationUs } }
          : { transitionOut: { ...current, durationUs } },
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
      patch:
        edge === 'in'
          ? { transitionIn: { ...current, type } }
          : { transitionOut: { ...current, type } },
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

  const newFlip = next.flip;
  const newAnchorPreset = next.anchorPreset;
  const newAnchor = next.anchor;

  const deltaScaleX = (next.scale?.x ?? 1) - (baseTransform.scale?.x ?? 1);
  const deltaScaleY = (next.scale?.y ?? 1) - (baseTransform.scale?.y ?? 1);
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

    cmds.push({
      type: 'update_clip_properties',
      trackId,
      itemId,
      properties: {
        transform: {
          ...curr,
          flip: newFlip,
          anchorPreset: newAnchorPreset,
          anchor: newAnchor,
          scale: {
            x: (curr.scale?.x ?? 1) + deltaScaleX,
            y: (curr.scale?.y ?? 1) + deltaScaleY,
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
  <div class="flex flex-col gap-4 w-full">
    <PropertySection :title="t('fastcat.timeline.multipleSelection', 'Multiple Selection')">
      <div class="px-3 pb-3 flex flex-col gap-4">
        <span class="text-sm text-ui-text-muted">
          {{ selectedCountLabel }}
        </span>

        <PropertyTimecode
          :label="t('common.duration', 'Duration')"
          :model-value="firstClip?.timelineRange.durationUs ?? 0"
          @update:model-value="handleSetUniformDuration"
        />

        <PropertyField :label="t('fastcat.timeline.startShift', 'Start Shift')" class="mt-2">
          <UiTimecode
            :model-value="0"
            @update:model-value="handleRelativeStartShift"
            allow-negative
          />
        </PropertyField>

        <PropertyField :label="t('fastcat.timeline.endShift', 'End Shift')" class="mt-2">
          <UiTimecode
            :model-value="0"
            @update:model-value="handleRelativeEndShift"
            allow-negative
          />
        </PropertyField>

        <div v-if="hasVideoOrImage" class="space-y-4 pt-2 border-t border-ui-border">
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

          <div class="flex flex-col gap-1">
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
        </div>

        <div v-if="hasAudioOrVideoWithAudio" class="pt-2 border-t border-ui-border">
          <div class="flex flex-col gap-1">
            <span class="text-xs text-ui-text-muted">{{
              t('fastcat.clip.audioGain', 'Audio Gain (dB)')
            }}</span>
            <UiWheelNumberInput
              v-model="batchAudioGain"
              size="sm"
              :step="0.1"
              :min="-60"
              :max="20"
            />
          </div>
        </div>
      </div>
    </PropertySection>

    <PropertySection :title="t('common.actions.title', 'Actions')">
      <div class="flex flex-col w-full px-3 pb-3">
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

    <ClipTransformSection
      v-if="hasVideoOrImage && firstVideoClip"
      :clip="firstVideoClip"
      track-kind="video"
      :can-edit-reversed="
        firstVideoClip.clipType === 'media' || firstVideoClip.clipType === 'timeline'
      "
      :is-reversed="typeof firstVideoClip.speed === 'number' && firstVideoClip.speed < 0"
      @update-transform="handleBatchTransform"
      @toggle-reversed="handleBatchToggleReversed"
      @update-speed="handleBatchUpdateSpeed"
    />
  </div>
</template>
