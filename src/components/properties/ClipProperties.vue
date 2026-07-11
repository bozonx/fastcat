<script setup lang="ts">
import { computed, ref, watch, inject, toRef, type Ref } from 'vue';
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
import { useMobileLayout } from '~/composables/useMobileLayout';
import { useFileManagerStore } from '~/stores/file-manager.store';
import {
  BLEND_MODE_OPTIONS as RAW_BLEND_MODE_OPTIONS,
  isTimelineBlendMode,
} from '~/utils/constants';
import type {
  AnimatableParamPath,
  AudioClipEffect,
  ClipAnimations,
  ClipTransform,
  FixedAnimatableParamPath,
  TimelineBlendMode,
  TimelineClipItem,
  TimelineTrack,
  TrackKind,
  VideoClipEffect,
} from '~/timeline/types';
import UiRenameModal from '~/components/ui/UiRenameModal.vue';
import UiTabs from '~/components/ui/UiTabs.vue';
import ClipAudioSection from '~/components/properties/clip/ClipAudioSection.vue';
import ClipTransitionsSection from '~/components/properties/clip/ClipTransitionsSection.vue';
import ClipActionsSection from '~/components/properties/clip/ClipActionsSection.vue';
import ClipInfoSection from '~/components/properties/clip/ClipInfoSection.vue';
import ClipBlendingModeSection from '~/components/properties/clip/ClipBlendingModeSection.vue';
import ClipOpacitySection from '~/components/properties/clip/ClipOpacitySection.vue';
import ClipTransformSection from '~/components/properties/clip/ClipTransformSection.vue';
import ClipKeyframeNavigator from '~/components/properties/clip/ClipKeyframeNavigator.vue';
import ClipTypeSection from '~/components/properties/clip/ClipTypeSection.vue';
import ClipMaskSection from '~/components/properties/clip/ClipMaskSection.vue';
import ClipParametersPasteModal from '~/components/properties/clip/ClipParametersPasteModal.vue';
import ClipBackgroundProperties from '~/components/properties/clip/ClipBackgroundProperties.vue';
import { getClipMaxTimelineDurationUs } from '~/utils/timeline/clip';
import ClipEffectsEditor from '~/components/effects/ClipEffectsEditor.vue';
import { useClipAudio } from '~/composables/properties/useClipAudio';
import { useClipTransitions } from '~/composables/properties/useClipTransitions';
import { useClipPropertiesActions } from '~/composables/properties/useClipPropertiesActions';
import { useClipTextProperties } from '~/composables/properties/useClipTextProperties';
import { useClipShapeProperties } from '~/composables/properties/useClipShapeProperties';
import { useClipHudProperties } from '~/composables/properties/useClipHudProperties';
import { useClipParametersClipboard } from '~/composables/editor/useClipParametersClipboard';
import { resolveClipParametersApplyTargets } from '~/utils/timeline/clip-parameters';
import { useClipKeyframes } from '~/composables/timeline/useClipKeyframes';
import { normalizeHexColor } from '~/utils/color';
import { upsertKeyframe } from '~/timeline/animation/ops';

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
const isHudFeatureEnabled = computed(() => workspaceStore.isFeatureEnabled('hud'));
const isAudioEffectsFeatureEnabled = computed(() => workspaceStore.inDevelopmentFeaturesEnabled);
const focusStore = useFocusStore();
const fileManagerStore = inject('fileManagerStore', useFileManagerStore()) as ReturnType<
  typeof useFileManagerStore
>;
const clipboardStore = useAppClipboard();

const { isMobile: isMobileDevice } = useDevice();
const { isMobileLayout } = useMobileLayout();
const isMobile = computed(() => isMobileDevice || isMobileLayout.value);

const isUiRenameModalOpen = ref(false);

const activeTab = ref('clip');

const showAudioTab = computed(() => {
  const clipType = props.clip.clipType;
  return clipType === 'media' || clipType === 'timeline';
});

const tabs = computed(() => [
  {
    label: t('fastcat.clip.tabs.clip'),
    value: 'clip',
    icon: 'i-heroicons-film',
  },
  ...(props.clip.clipType === 'text'
    ? [
        {
          label: t('fastcat.clip.tabs.text'),
          value: 'text',
          icon: 'i-heroicons-bars-3-bottom-left',
        },
      ]
    : []),
  ...(hasVideoProperties.value
    ? [
        {
          label: t('fastcat.clip.tabs.video'),
          value: 'video',
          icon: 'i-heroicons-sparkles',
        },
      ]
    : []),
  ...(showAudioTab.value
    ? [
        {
          label: t('fastcat.clip.tabs.audio'),
          value: 'audio',
          icon: 'i-heroicons-speaker-wave',
          disabled: !canEditAudioGain.value,
        },
      ]
    : []),
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
const clipRef = toRef(props, 'clip');

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

const hasVideoProperties = computed(
  () =>
    isVideoTrack.value || (props.clip.effects ?? []).some((effect) => effect?.target !== 'audio'),
);

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

const {
  isPasteParametersModalOpen,
  selectedParameterGroups,
  clipParameterGroupOptions,
  copyClipParameters,
  openPasteClipParameters,
  applyClipParameters,
} = useClipParametersClipboard({
  clip: clipRef,
  trackKind: clipTrackKind,
  resolveApplyTargets: (target) =>
    resolveClipParametersApplyTargets({
      doc: timelineStore.timelineDoc,
      selectedItemIds: timelineStore.selectedItemIds,
      target,
    }),
  applyCommands: (cmds) =>
    timelineStore.batchApplyTimeline(cmds, {
      historyMode: 'immediate',
      labelKey: 'videoEditor.fileManager.history.entries.updateClipProperties',
    }),
});

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

const { handleDeleteClip, otherActionsList, commonActionsList } = useClipPropertiesActions({
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
  inDevelopmentFeaturesEnabled: computed(() => workspaceStore.inDevelopmentFeaturesEnabled),
});

const mediaMeta = computed(() => {
  if (props.clip.clipType !== 'media' || !props.clip.source?.path) return null;
  return mediaStore.getCachedMetadata(props.clip.source.path) || null;
});

const MOBILE_HIDDEN_ACTION_IDS = new Set(['showInFileManager', 'replaceMedia']);

const visibleOtherActionsList = computed(() =>
  isMobile.value
    ? otherActionsList.value.filter((a) => !MOBILE_HIDDEN_ACTION_IDS.has(a.id))
    : otherActionsList.value,
);

function handleUpdateStartTime(val: number) {
  const newStartUs = Math.max(0, Math.round(val));
  if (newStartUs === props.clip.timelineRange.startUs) return;
  timelineStore.applyTimeline(
    {
      type: 'move_item',
      trackId: props.clip.trackId,
      itemId: props.clip.id,
      startUs: newStartUs,
      quantizeToFrames: false,
    },
    { historyMode: 'debounced' },
  );
}

function handleUpdateEndTime(val: number) {
  const startUs = props.clip.timelineRange.startUs;
  // Clamp into the clip's allowed [start, start + maxDuration] window as a
  // second line of defense — the UI input already clamps, but this guards any
  // programmatic callers and prevents a manual entry from exceeding the clip's
  // source material (which would otherwise trigger a source-window slip).
  const maxEndUs = startUs + getClipMaxTimelineDurationUs(props.clip);
  const newEndUs = Math.min(
    Math.max(startUs, Math.round(val)),
    Number.isFinite(maxEndUs) ? maxEndUs : Number.POSITIVE_INFINITY,
  );
  const currentEndUs = startUs + props.clip.timelineRange.durationUs;
  if (newEndUs === currentEndUs) return;
  timelineStore.applyTimeline(
    {
      type: 'trim_item',
      trackId: props.clip.trackId,
      itemId: props.clip.id,
      edge: 'end',
      deltaUs: newEndUs - currentEndUs,
    },
    { historyMode: 'debounced' },
  );
}

// Keyframe animation (v1: opacity + transform). The playhead-driven "current
// value" and "record edit as keyframe" logic lives in the shared composable so
// the timeline's keyframe lane and this panel stay in sync.
const playheadUs = computed(() => timelineStore.currentTime) as Ref<number>;
const clipKeyframes = useClipKeyframes({
  clip: clipRef,
  playheadUs,
  updateAnimations: (next: ClipAnimations | undefined) => {
    timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, { animations: next });
  },
  seek: (timelineUs: number) => timelineStore.setCurrentTimeUs(timelineUs),
});

const hasAnyKeyframes = computed(() => clipKeyframes.keyframeTimes.value.length > 0);

function handleCopyKeyframeMoment() {
  const moment = clipKeyframes.copyMomentAtPlayhead();
  if (moment) clipboardStore.setKeyframeMomentClipboard(moment);
}

function handlePasteKeyframeMoment() {
  const moment = clipboardStore.keyframeMomentClipboard;
  if (moment) clipKeyframes.pasteMomentAtPlayhead(moment);
}

type AnimationPreset = 'fade-in' | 'fade-out' | 'ken-burns' | 'slide-in';

function handleApplyAnimationPreset(preset: AnimationPreset) {
  const durationUs = Math.max(
    1,
    props.clip.sourceRange.durationUs || props.clip.timelineRange.durationUs,
  );
  const presetSpanUs = Math.min(1_000_000, durationUs);
  let next = props.clip.animations;

  if (preset === 'fade-in') {
    next = upsertKeyframe(next, 'opacity', props.clip.sourceRange.startUs, 0, 'linear');
    next = upsertKeyframe(
      next,
      'opacity',
      props.clip.sourceRange.startUs + presetSpanUs,
      1,
      'linear',
    );
  } else if (preset === 'fade-out') {
    const endUs = props.clip.sourceRange.startUs + durationUs;
    next = upsertKeyframe(
      next,
      'opacity',
      Math.max(props.clip.sourceRange.startUs, endUs - presetSpanUs),
      1,
      'linear',
    );
    next = upsertKeyframe(next, 'opacity', endUs, 0, 'linear');
  } else if (preset === 'ken-burns') {
    next = upsertKeyframe(next, 'transform.scale.x', props.clip.sourceRange.startUs, 1, 'ease');
    next = upsertKeyframe(next, 'transform.scale.y', props.clip.sourceRange.startUs, 1, 'ease');
    next = upsertKeyframe(
      next,
      'transform.scale.x',
      props.clip.sourceRange.startUs + durationUs,
      1.12,
      'linear',
    );
    next = upsertKeyframe(
      next,
      'transform.scale.y',
      props.clip.sourceRange.startUs + durationUs,
      1.12,
      'linear',
    );
  } else if (preset === 'slide-in') {
    next = upsertKeyframe(
      next,
      'transform.position.x',
      props.clip.sourceRange.startUs,
      -400,
      'ease',
    );
    next = upsertKeyframe(
      next,
      'transform.position.x',
      props.clip.sourceRange.startUs + presetSpanUs,
      0,
      'linear',
    );
    next = upsertKeyframe(next, 'opacity', props.clip.sourceRange.startUs, 0, 'linear');
    next = upsertKeyframe(
      next,
      'opacity',
      props.clip.sourceRange.startUs + presetSpanUs,
      1,
      'linear',
    );
  }

  timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, { animations: next });
}

function handleUpdateOpacity(val: number) {
  const safe = typeof val === 'number' && Number.isFinite(val) ? val : 1;
  if (clipKeyframes.recordValue('opacity', safe)) return;
  timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, { opacity: safe });
}

function handleToggleOpacityAnimation() {
  clipKeyframes.toggleAnimated(['opacity']);
}

function handleUpdateBlendMode(val: TimelineBlendMode | string) {
  const safe = isTimelineBlendMode(val) ? val : 'normal';
  timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, { blendMode: safe });
}

function handleUpdateTransform(next: ClipTransform) {
  timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, {
    transform: next,
    transformActive: true,
  });
}

function handleToggleTransformParamAnimation(paths: FixedAnimatableParamPath[]) {
  clipKeyframes.toggleAnimated(paths);
}

function handleRecordAnimatedTransformValue(path: AnimatableParamPath, value: number) {
  clipKeyframes.recordValue(path, value);
}

function handleUpdateMask(mask: unknown) {
  timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, {
    mask: mask as TimelineClipItem['mask'],
  });
}

// Keyframe hooks for animating video clip-effect params (numeric + boolean).
// Numbers seed/record directly; booleans map to 0/1. Interpolated values are
// fed back through `displayValues` so the controls show what's playing.
const clipEffectKeyframes = {
  isAnimated: (effectId: string, key: string) =>
    clipKeyframes.isEffectParamAnimated(effectId, key) ||
    ['r', 'g', 'b'].some((channel) =>
      clipKeyframes.isEffectParamAnimated(effectId, `${key}.${channel}`),
    ),
  toggle: (effectId: string, key: string) => {
    const effect = (props.clip.effects ?? []).find(
      (e) => (e as Record<string, unknown>).id === effectId,
    ) as Record<string, unknown> | undefined;
    const cur = effect?.[key];
    if (typeof cur === 'string') {
      const hex = normalizeHexColor(cur, '#000000').slice(1);
      for (const [channel, start, end] of [
        ['r', 0, 2],
        ['g', 2, 4],
        ['b', 4, 6],
      ] as const) {
        clipKeyframes.toggleEffectParam(
          effectId,
          `${key}.${channel}`,
          Number.parseInt(hex.slice(start, end), 16),
        );
      }
      return;
    }
    const seed = typeof cur === 'boolean' ? (cur ? 1 : 0) : Number(cur ?? 0);
    clipKeyframes.toggleEffectParam(effectId, key, Number.isFinite(seed) ? seed : 0);
  },
  recordEdit: (effectId: string, key: string, value: unknown) => {
    if (typeof value === 'string') {
      if (
        !['r', 'g', 'b'].some((channel) =>
          clipKeyframes.isEffectParamAnimated(effectId, `${key}.${channel}`),
        )
      ) {
        return false;
      }
      const hex = normalizeHexColor(value, '#000000').slice(1);
      for (const [channel, start, end] of [
        ['r', 0, 2],
        ['g', 2, 4],
        ['b', 4, 6],
      ] as const) {
        clipKeyframes.recordEffectParam(
          effectId,
          `${key}.${channel}`,
          Number.parseInt(hex.slice(start, end), 16),
        );
      }
      return true;
    }
    const num = typeof value === 'boolean' ? (value ? 1 : 0) : Number(value);
    if (!Number.isFinite(num)) return false;
    return clipKeyframes.recordEffectParam(effectId, key, num);
  },
  displayValues: (effect: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    const id = String(effect.id);
    for (const key of Object.keys(effect)) {
      if (!clipKeyframes.isEffectParamAnimated(id, key)) continue;
      const cur = effect[key];
      const staticNum = typeof cur === 'boolean' ? (cur ? 1 : 0) : Number(cur ?? 0);
      out[key] = clipKeyframes.effectParamDisplayValue(id, key, staticNum);
    }
    for (const [key, value] of Object.entries(effect)) {
      if (typeof value !== 'string') continue;
      const hex = normalizeHexColor(value, '#000000').slice(1);
      const channels = {
        r: Number.parseInt(hex.slice(0, 2), 16),
        g: Number.parseInt(hex.slice(2, 4), 16),
        b: Number.parseInt(hex.slice(4, 6), 16),
      };
      const sampled = {
        r: clipKeyframes.effectParamDisplayValue(id, `${key}.r`, channels.r),
        g: clipKeyframes.effectParamDisplayValue(id, `${key}.g`, channels.g),
        b: clipKeyframes.effectParamDisplayValue(id, `${key}.b`, channels.b),
      };
      if (
        sampled.r !== channels.r ||
        sampled.g !== channels.g ||
        sampled.b !== channels.b ||
        ['r', 'g', 'b'].some((channel) =>
          clipKeyframes.isEffectParamAnimated(id, `${key}.${channel}`),
        )
      ) {
        const toHex = (n: number) =>
          Math.max(0, Math.min(255, Math.round(n)))
            .toString(16)
            .padStart(2, '0');
        out[key] = `#${toHex(sampled.r)}${toHex(sampled.g)}${toHex(sampled.b)}`;
      }
    }
    return out;
  },
};

function handleUpdateClipEffects(effects: Array<VideoClipEffect | AudioClipEffect>) {
  const audioEffects = (clipRef.value?.effects ?? []).filter(
    (e): e is AudioClipEffect => e?.target === 'audio',
  );
  timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, {
    effects: [...effects.filter((e) => e.target !== 'audio'), ...audioEffects],
  });
}

function handleUpdateClipAudioEffects(effects: Array<VideoClipEffect | AudioClipEffect>) {
  const videoEffects = (clipRef.value?.effects ?? []).filter((e) => e?.target !== 'audio');
  timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, {
    effects: [...videoEffects, ...effects.filter((e) => e.target === 'audio')],
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

function handleUpdateSnapToPixelGrid(val: boolean) {
  timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, {
    snapToPixelGrid: val,
  });
}

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
  onVolumeDragStart,
  onVolumeDragEnd,
} = useClipAudio({
  clip: clipRef,
  tracks: computed(() => timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined),
  mediaMetadataByPath: computed(() => mediaStore.mediaMetadata),
  updateAudio: (patch, options) => {
    timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, patch, options);
  },
  pushHistory: (preState, commandType, labelKey) => {
    timelineStore.pushTimelineHistory(preState, commandType, labelKey);
  },
  getTimelineDoc: () => timelineStore.timelineDoc,
  isParamAnimated: clipKeyframes.isAnimated,
  onAnimatedParamEdit: clipKeyframes.recordValue,
  getAnimatedDisplayValue: clipKeyframes.currentValue,
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
  () => props.clip.clipType,
  (clipType) => {
    if (activeTab.value === 'text' && clipType !== 'text') {
      activeTab.value = 'clip';
    }
  },
);

watch(tabs, (newTabs) => {
  if (!newTabs.some((t) => t.value === activeTab.value)) {
    activeTab.value = 'clip';
  }
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
    <ClipBackgroundProperties
      v-if="clip.clipType === 'background'"
      :clip="clip"
      @update-background-color="handleUpdateBackgroundColor"
    />

    <UiTabs
      v-if="clip.clipType !== 'adjustment'"
      v-model="activeTab"
      :options="tabs"
      class="mb-2"
    />

    <!-- Adjustment clip: flat layout without tabs -->
    <template v-if="clip.clipType === 'adjustment'">
      <div ref="effectsSectionRef">
        <ClipEffectsEditor
          v-model:enabled="isVideoEffectsEnabled"
          target="video"
          :effects="clipVideoEffects"
          :keyframes="clipEffectKeyframes"
          :title="t('fastcat.effects.videoTitle')"
          :add-label="t('fastcat.effects.add')"
          :empty-label="t('fastcat.effects.empty')"
          :has-toggle="true"
          :disabled="!isVideoEffectsEnabled"
          @update:effects="handleUpdateClipEffects"
        />
      </div>

      <ClipTransitionsSection
        v-if="!isMobile"
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

      <ClipActionsSection
        v-if="!hideActions"
        :common-actions="isMobile ? [] : commonActionsList"
        :other-actions="visibleOtherActionsList"
        @rename="isUiRenameModalOpen = true"
        @copy="handleCopyClip"
        @cut="handleCutClip"
        @copy-parameters="copyClipParameters"
        @paste-parameters="openPasteClipParameters"
      />

      <ClipInfoSection
        :clip="clip"
        :media-meta="mediaMeta"
        :show-source="false"
        @update-start-time="handleUpdateStartTime"
        @update-end-time="handleUpdateEndTime"
      />
    </template>

    <!-- Tab: Clip -->
    <div v-else-if="activeTab === 'clip'" class="flex flex-col gap-2">
      <ClipActionsSection
        v-if="!hideActions"
        :common-actions="isMobile ? [] : commonActionsList"
        :other-actions="visibleOtherActionsList"
        @rename="isUiRenameModalOpen = true"
        @copy="handleCopyClip"
        @cut="handleCutClip"
        @copy-parameters="copyClipParameters"
        @paste-parameters="openPasteClipParameters"
      />

      <ClipInfoSection
        :clip="clip"
        :media-meta="mediaMeta"
        :show-source="false"
        @update-start-time="handleUpdateStartTime"
        @update-end-time="handleUpdateEndTime"
      />

      <ClipTypeSection
        :clip="clip"
        :hud-manifest="hudManifest"
        :hud-control-values="hudControlValues"
        :hud-feature-enabled="isHudFeatureEnabled"
        :hide-text-properties="true"
        @update-background-color="handleUpdateBackgroundColor"
        @update-text="handleUpdateText"
        @update-text-style="handleUpdateTextStyle"
        @update-shape-type="handleUpdateShapeType"
        @update-fill-color="handleUpdateFillColor"
        @update-stroke-color="handleUpdateStrokeColor"
        @update-stroke-width="handleUpdateStrokeWidth"
        @update-shape-config="handleUpdateShapeConfig"
        @update-snap-to-pixel-grid="handleUpdateSnapToPixelGrid"
        @update-hud-control="handleUpdateHudControl"
      />

      <ClipInfoSection :clip="clip" :media-meta="mediaMeta" :show-info="false" />
    </div>

    <!-- Tab: Text -->
    <div v-else-if="activeTab === 'text' && clip.clipType === 'text'" class="flex flex-col gap-2">
      <ClipTypeSection
        :clip="clip"
        :hud-manifest="hudManifest"
        :hud-control-values="hudControlValues"
        :hud-feature-enabled="isHudFeatureEnabled"
        @update-background-color="handleUpdateBackgroundColor"
        @update-text="handleUpdateText"
        @update-text-style="handleUpdateTextStyle"
        @update-shape-type="handleUpdateShapeType"
        @update-fill-color="handleUpdateFillColor"
        @update-stroke-color="handleUpdateStrokeColor"
        @update-stroke-width="handleUpdateStrokeWidth"
        @update-shape-config="handleUpdateShapeConfig"
        @update-snap-to-pixel-grid="handleUpdateSnapToPixelGrid"
        @update-hud-control="handleUpdateHudControl"
      />
    </div>

    <!-- Tab: Video -->
    <div v-else-if="activeTab === 'video'" class="flex flex-col gap-2">
      <div class="flex items-center justify-between px-1 py-1 rounded bg-ui-bg-elevated/30">
        <span class="text-2xs text-ui-text-muted uppercase tracking-wide">{{
          t('fastcat.clip.animation.presetsTitle')
        }}</span>
        <div class="flex items-center gap-0.5">
          <button
            type="button"
            class="p-1 rounded text-ui-text-muted hover:text-ui-text hover:bg-ui-border-elevated"
            :title="t('fastcat.clip.animation.fadeInPreset')"
            @click="handleApplyAnimationPreset('fade-in')"
          >
            <UIcon name="i-heroicons-arrow-trending-up" class="w-3.5 h-3.5 block" />
          </button>
          <button
            type="button"
            class="p-1 rounded text-ui-text-muted hover:text-ui-text hover:bg-ui-border-elevated"
            :title="t('fastcat.clip.animation.fadeOutPreset')"
            @click="handleApplyAnimationPreset('fade-out')"
          >
            <UIcon name="i-heroicons-arrow-trending-down" class="w-3.5 h-3.5 block" />
          </button>
          <button
            type="button"
            class="p-1 rounded text-ui-text-muted hover:text-ui-text hover:bg-ui-border-elevated"
            :title="t('fastcat.clip.animation.kenBurnsPreset')"
            @click="handleApplyAnimationPreset('ken-burns')"
          >
            <UIcon name="i-heroicons-magnifying-glass-plus" class="w-3.5 h-3.5 block" />
          </button>
          <button
            type="button"
            class="p-1 rounded text-ui-text-muted hover:text-ui-text hover:bg-ui-border-elevated"
            :title="t('fastcat.clip.animation.slideInPreset')"
            @click="handleApplyAnimationPreset('slide-in')"
          >
            <UIcon name="i-heroicons-arrow-right" class="w-3.5 h-3.5 block" />
          </button>
        </div>
      </div>

      <ClipBlendingModeSection
        v-model:enabled="isBlendingEnabled"
        :clip-type="clip.clipType"
        :blend-mode="(clip.blendMode ?? 'normal') as TimelineBlendMode"
        :blend-mode-options="blendModeOptions"
        @update-blend-mode="handleUpdateBlendMode"
      />

      <div
        v-if="hasAnyKeyframes"
        class="flex items-center justify-between px-1 py-1.5 rounded bg-ui-bg-elevated/40"
      >
        <span class="text-2xs text-ui-text-muted uppercase tracking-wide">{{
          t('fastcat.timeline.keyframesTitle')
        }}</span>
        <ClipKeyframeNavigator
          :is-on-keyframe="clipKeyframes.isOnKeyframe.value"
          :can-paste="clipboardStore.hasKeyframeMomentPayload"
          @prev="clipKeyframes.seekPrevKeyframe"
          @next="clipKeyframes.seekNextKeyframe"
          @toggle="clipKeyframes.toggleKeyframeAtPlayhead"
          @copy="handleCopyKeyframeMoment"
          @paste="handlePasteKeyframeMoment"
        />
      </div>

      <ClipOpacitySection
        v-model:enabled="isOpacityEnabled"
        :clip-type="clip.clipType"
        :opacity="clipKeyframes.currentValue('opacity', clip.opacity ?? 1)"
        :is-animated="clipKeyframes.isAnimated('opacity')"
        @update-opacity="handleUpdateOpacity"
        @toggle-animation="handleToggleOpacityAnimation"
      />

      <ClipTransformSection
        v-model:enabled="isTransformEnabled"
        :clip="clip"
        :track-kind="clipTrackKind"
        :can-edit-reversed="canEditReversed"
        :is-reversed="isReversed"
        :media-meta="mediaMeta"
        :is-param-animated="clipKeyframes.isAnimated"
        :get-animated-value="clipKeyframes.currentValue"
        @update-transform="handleUpdateTransform"
        @toggle-param-animation="handleToggleTransformParamAnimation"
        @record-animated-value="handleRecordAnimatedTransformValue"
        @update-source-orientation="
          (sourceOrientation) =>
            timelineStore.updateClipProperties(clip.trackId, clip.id, {
              sourceOrientation: sourceOrientation as TimelineClipItem['sourceOrientation'],
            })
        "
        @toggle-reversed="toggleReversed"
      />

      <ClipMaskSection
        v-if="isVideoTrack && workspaceStore.inDevelopmentFeaturesEnabled"
        v-model:enabled="isMaskEnabled"
        :clip="clip"
        @update-mask="handleUpdateMask"
      />

      <ClipTransitionsSection
        v-if="!isMobile"
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
        <ClipEffectsEditor
          v-model:enabled="isVideoEffectsEnabled"
          target="video"
          :effects="clipVideoEffects"
          :keyframes="clipEffectKeyframes"
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
        :is-param-animated="clipKeyframes.isAnimated"
        @update-audio-gain="updateAudioGain"
        @update-audio-balance="updateAudioBalance"
        @toggle-param-animation="clipKeyframes.toggleAnimated"
        @update-audio-fade-in-curve="updateAudioFadeInCurve"
        @update-audio-fade-in-sec="updateAudioFadeInSec"
        @update-audio-fade-out-curve="updateAudioFadeOutCurve"
        @update-audio-fade-out-sec="updateAudioFadeOutSec"
        @volume-drag-start="onVolumeDragStart"
        @volume-drag-end="onVolumeDragEnd"
      />

      <ClipEffectsEditor
        v-if="isAudioEffectsFeatureEnabled && canEditAudioEffects"
        v-model:enabled="isAudioEffectsEnabled"
        target="audio"
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

    <ClipParametersPasteModal
      v-model:open="isPasteParametersModalOpen"
      v-model:selected-groups="selectedParameterGroups"
      :groups="clipParameterGroupOptions"
      @apply="applyClipParameters"
    />
  </div>
</template>

<style scoped>
:deep([data-state='active']) {
  color: var(--selection-accent-400) !important;
}
</style>
