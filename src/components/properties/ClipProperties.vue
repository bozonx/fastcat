<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { useProjectTabs } from '~/composables/project/useProjectTabs';
import { useMediaStore } from '~/stores/media.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useEditorViewStore } from '~/stores/editorView.store';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import { useFilesPageStore } from '~/stores/filesPage.store';
import type {
  AudioClipEffect,
  TimelineBlendMode,
  TimelineClipItem,
  TimelineTextClipItem,
  TimelineTrack,
  TrackKind,
  VideoClipEffect,
} from '~/timeline/types';
import WheelSlider from '~/components/ui/WheelSlider.vue';
import WheelNumberInput from '~/components/ui/WheelNumberInput.vue';
import AudioEffectsEditor from '~/components/common/AudioEffectsEditor.vue';
import EffectsEditor from '~/components/common/EffectsEditor.vue';
import RenameModal from '~/components/common/RenameModal.vue';
import TimecodeInput from '~/components/common/TimecodeInput.vue';
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyRow from '~/components/properties/PropertyRow.vue';
import ParamsRenderer from '~/components/properties/ParamsRenderer.vue';
import ClipAudioSection from '~/components/properties/clip/ClipAudioSection.vue';
import ClipTransitionsSection from '~/components/properties/clip/ClipTransitionsSection.vue';
import { useClipTransform } from '~/composables/properties/useClipTransform';
import { useClipAudio } from '~/composables/properties/useClipAudio';
import { useClipTransitions } from '~/composables/properties/useClipTransitions';
import { useClipPropertiesActions } from '~/composables/properties/useClipPropertiesActions';
import { useClipTextProperties } from '~/composables/properties/useClipTextProperties';
import { useClipShapeProperties } from '~/composables/properties/useClipShapeProperties';
import { useClipHudProperties } from '~/composables/properties/useClipHudProperties';
import { formatAudioChannels } from '~/utils/audio';

const props = defineProps<{
  clip: TimelineClipItem;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();
const projectStore = useProjectStore();
const { setActiveTab } = useProjectTabs();
const mediaStore = useMediaStore();
const selectionStore = useSelectionStore();
const editorViewStore = useEditorViewStore();
const fileManager = useFileManager();
const uiStore = useUiStore();
const focusStore = useFocusStore();
const filesPageStore = useFilesPageStore();

const isRenameModalOpen = ref(false);

const clipRef = computed(() => props.clip);

const clipTrack = computed<TimelineTrack | undefined>(() =>
  timelineStore.timelineDoc?.tracks.find((t) => t.id === props.clip.trackId),
);

const clipTrackKind = computed<TrackKind>(() => clipTrack.value?.kind ?? 'video');

const blendModeOptions: Array<{ value: TimelineBlendMode; label: string }> = [
  { value: 'normal', label: 'Normal' },
  { value: 'add', label: 'Add' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
];

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
  handleRenameClip,
  handleSelectInFileManager,
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

function handleUpdateOpacity(val: number | undefined) {
  const safe = typeof val === 'number' && Number.isFinite(val) ? val : 1;
  timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, {
    opacity: safe,
  });
}

function handleUpdateBlendMode(val: TimelineBlendMode | string | undefined) {
  const safe =
    val === 'add' || val === 'multiply' || val === 'screen' || val === 'darken' || val === 'lighten'
      ? val
      : 'normal';

  timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, {
    blendMode: safe,
  });
}

function handleUpdateClipEffects(effects: any[]) {
  const audioEffects = (clipRef.value?.effects ?? []).filter(
    (e): e is AudioClipEffect => e?.target === 'audio',
  );
  timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, {
    effects: [...effects, ...audioEffects] as any,
  });
}

function handleUpdateClipAudioEffects(effects: AudioClipEffect[]) {
  const videoEffects = (clipRef.value?.effects ?? []).filter((e) => e?.target !== 'audio');
  timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, {
    effects: [...videoEffects, ...effects] as any,
  });
}

function handleUpdateBackgroundColor(val: string | undefined) {
  if (props.clip.clipType !== 'background') return;
  const safe = typeof val === 'string' && val.trim().length > 0 ? val.trim() : '#000000';
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

const {
  anchorPresetOptions,
  canEditTransform,
  transformAnchorPreset,
  transformAnchorX,
  transformAnchorY,
  transformPosX,
  transformPosY,
  transformRotationDeg,
  transformScaleLinked,
  transformScaleX,
  transformScaleY,
  toggleFlipHorizontal,
  toggleFlipVertical,
} = useClipTransform({
  clip: clipRef,
  trackKind: clipTrackKind,
  updateTransform: (next) => {
    timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, { transform: next });
  },
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

const canEditAudioEffects = computed(() => {
  if (!canEditAudioFades.value) return false;
  if (!canEditAudioGain.value) return false;
  return true;
});

const { selectTransitionEdge, toggleTransition, updateTransitionDuration, updateTransitionType } =
  useClipTransitions({
    clip: clipRef,
    defaultDurationUs: computed(() =>
      Math.max(
        0,
        Math.round(
          Number(projectStore.projectSettings?.transitions?.defaultDurationUs ?? 2_000_000),
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
    // We need to find the scrollable container.
    // In PropertiesPanel.vue it is .overflow-auto
    const container = effectsSectionRef.value.closest('.overflow-auto');
    if (container) {
      container.scrollTo({
        top: effectsSectionRef.value.offsetTop - 10,
        behavior: 'smooth',
      });
    }
  },
);

defineExpose({
  isRenameModalOpen,
  handleDeleteClip,
});
</script>

<template>
  <div class="w-full flex flex-col gap-2 text-ui-text">
    <PropertySection :title="t('fastcat.clip.actions', 'Actions')">
      <div class="flex gap-2 w-full">
        <UButton
          size="xs"
          variant="soft"
          color="neutral"
          icon="i-heroicons-pencil"
          class="flex-1 justify-center"
          @click="isRenameModalOpen = true"
        >
          {{ t('common.rename', 'Rename') }}
        </UButton>
        <UButton
          size="xs"
          variant="soft"
          color="red"
          icon="i-heroicons-trash"
          class="flex-1 justify-center"
          @click="handleDeleteClip"
        >
          {{ t('common.delete', 'Delete') }}
        </UButton>
      </div>

      <UButton
        v-if="isFreePosition"
        size="xs"
        variant="soft"
        color="neutral"
        icon="i-heroicons-squares-2x2"
        class="w-full justify-center mt-2"
        @click="handleQuantizeClip"
      >
        {{ t('fastcat.timeline.quantize', 'Quantize to frames') }}
      </UButton>

      <UButton
        v-if="hasLockedLinkedAudio || isLockedLinkedAudioClip"
        size="xs"
        variant="soft"
        color="neutral"
        icon="i-heroicons-link-slash"
        class="w-full justify-center mt-2"
        @click="handleUnlinkAudio"
      >
        {{ t('fastcat.timeline.unlinkAudio', 'Unlink audio') }}
      </UButton>

      <UButton
        v-if="isInLinkedGroup"
        size="xs"
        variant="soft"
        color="neutral"
        icon="i-heroicons-link-slash"
        class="w-full justify-center mt-2"
        @click="handleRemoveFromGroup"
      >
        {{ t('fastcat.timeline.removeFromGroup', 'Remove from group') }}
      </UButton>

      <UButton
        v-if="clip.clipType === 'media'"
        size="xs"
        variant="soft"
        color="neutral"
        icon="i-heroicons-folder-open"
        class="w-full justify-center mt-2"
        @click="handleSelectInFileManager"
      >
        {{ t('fastcat.clip.showInFileManager', 'Show in File Manager') }}
      </UButton>

      <template v-if="canEditAudioGain">
        <UButton
          v-if="clipTrackKind === 'video'"
          size="xs"
          variant="soft"
          color="neutral"
          icon="i-heroicons-eye"
          class="w-full justify-center mt-2"
          @click="toggleShowWaveform"
        >
          {{
            clip.showWaveform === false
              ? t('fastcat.clip.showWaveform', 'Show Waveform')
              : t('fastcat.clip.hideWaveform', 'Hide Waveform')
          }}
        </UButton>

        <UButton
          v-if="clipTrackKind === 'video'"
          size="xs"
          variant="soft"
          color="neutral"
          icon="i-heroicons-photo"
          class="w-full justify-center mt-2"
          @click="toggleShowThumbnails"
        >
          {{
            clip.showThumbnails === false
              ? t('fastcat.clip.showThumbnails', 'Show Thumbnails')
              : t('fastcat.clip.hideThumbnails', 'Hide Thumbnails')
          }}
        </UButton>

        <UButton
          v-if="clipTrackKind === 'audio' || clip.showWaveform !== false"
          size="xs"
          variant="soft"
          color="neutral"
          icon="i-heroicons-chart-bar"
          class="w-full justify-center mt-2"
          @click="toggleAudioWaveformMode"
        >
          {{
            (clip.audioWaveformMode || 'half') === 'full'
              ? t('fastcat.clip.halfWaveform', 'Half Waveform')
              : t('fastcat.clip.fullWaveform', 'Full Waveform')
          }}
        </UButton>
      </template>
    </PropertySection>

    <PropertySection v-if="clip.clipType === 'media'" :title="t('common.source', 'Source File')">
      <PropertyRow :label="t('common.path', 'Path')" :value="clip.source.path" />
      <template v-if="mediaMeta?.video">
        <PropertyRow
          :label="t('videoEditor.fileManager.video.resolution', 'Resolution')"
          :value="
            mediaMeta.video.displayWidth && mediaMeta.video.displayHeight
              ? `${mediaMeta.video.displayWidth}x${mediaMeta.video.displayHeight}`
              : '-'
          "
        />
        <PropertyRow
          :label="t('videoEditor.fileManager.video.fps', 'FPS')"
          :value="mediaMeta.video.fps ?? '-'"
        />
      </template>
      <template v-if="mediaMeta?.audio">
        <PropertyRow :label="t('videoEditor.fileManager.audio.channels', 'Channels')">
          {{ formatAudioChannels(mediaMeta.audio.channels) }},
          {{ mediaMeta.audio.sampleRate ? `${mediaMeta.audio.sampleRate} Hz` : '-' }}
        </PropertyRow>
      </template>
    </PropertySection>

    <PropertySection :title="t('fastcat.clip.info', 'Clip Info')">
      <div class="flex flex-col gap-0.5 mt-2">
        <span class="text-xs text-ui-text-muted">{{ t('common.duration', 'Duration') }}</span>
        <TimecodeInput
          :model-value="clip.timelineRange.durationUs"
          @update:model-value="handleUpdateDuration"
        />
      </div>

      <div class="flex flex-col gap-0.5 mt-2">
        <span class="text-xs text-ui-text-muted">{{ t('common.start', 'Start Time') }}</span>
        <TimecodeInput
          :model-value="clip.timelineRange.startUs"
          @update:model-value="handleUpdateStartTime"
        />
      </div>

      <div class="flex flex-col gap-0.5 mt-2">
        <span class="text-xs text-ui-text-muted">{{ t('common.end', 'End Time') }}</span>
        <TimecodeInput
          :model-value="clip.timelineRange.startUs + clip.timelineRange.durationUs"
          @update:model-value="handleUpdateEndTime"
        />
      </div>
    </PropertySection>

    <PropertySection v-if="clip.clipType === 'background'" :title="t('common.color', 'Color')">
      <div class="flex items-center justify-between gap-3">
        <span class="font-mono text-xs text-ui-text">{{ clip.backgroundColor }}</span>
        <UColorPicker
          :model-value="clip.backgroundColor"
          format="hex"
          size="sm"
          @update:model-value="handleUpdateBackgroundColor"
        />
      </div>
    </PropertySection>

    <PropertySection
      v-else-if="clip.clipType === 'text'"
      :title="t('fastcat.textClip.text', 'Text')"
    >
      <div class="flex flex-col gap-2">
        <UTextarea
          :model-value="(clip as TimelineTextClipItem).text"
          size="sm"
          :rows="4"
          @update:model-value="handleUpdateText"
        />

        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-ui-text-muted">{{
            t('fastcat.textClip.fontFamily', 'Font family')
          }}</span>
          <USelectMenu
            :model-value="String((clip as TimelineTextClipItem).style?.fontFamily ?? 'sans-serif')"
            :items="[
              { value: 'sans-serif', label: 'Sans Serif' },
              { value: 'serif', label: 'Serif' },
              { value: 'monospace', label: 'Monospace' },
              { value: 'Arial', label: 'Arial' },
              { value: 'Arial Black', label: 'Arial Black' },
              { value: 'Verdana', label: 'Verdana' },
              { value: 'Tahoma', label: 'Tahoma' },
              { value: 'Trebuchet MS', label: 'Trebuchet MS' },
              { value: 'Georgia', label: 'Georgia' },
              { value: 'Times New Roman', label: 'Times New Roman' },
              { value: 'Courier New', label: 'Courier New' },
              { value: 'Impact', label: 'Impact' },
            ]"
            value-key="value"
            label-key="label"
            size="sm"
            @update:model-value="(v: any) => handleUpdateTextStyle({ fontFamily: v?.value ?? v })"
          />
        </div>

        <div class="grid grid-cols-2 gap-2">
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-ui-text-muted">{{
              t('fastcat.textClip.fontSize', 'Font size')
            }}</span>
            <WheelNumberInput
              :model-value="Number((clip as TimelineTextClipItem).style?.fontSize ?? 64)"
              size="sm"
              :step="1"
              :min="1"
              @update:model-value="(v: any) => handleUpdateTextStyle({ fontSize: Number(v) })"
            />
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-ui-text-muted">{{
              t('fastcat.textClip.fontWeight', 'Font weight')
            }}</span>
            <USelectMenu
              :model-value="String((clip as TimelineTextClipItem).style?.fontWeight ?? '700')"
              :items="[
                { value: '100', label: '100' },
                { value: '200', label: '200' },
                { value: '300', label: '300' },
                { value: '400', label: '400' },
                { value: '500', label: '500' },
                { value: '600', label: '600' },
                { value: '700', label: '700' },
                { value: '800', label: '800' },
                { value: '900', label: '900' },
              ]"
              value-key="value"
              label-key="label"
              size="sm"
              @update:model-value="(v: any) => handleUpdateTextStyle({ fontWeight: v?.value ?? v })"
            />
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-ui-text-muted">{{ t('common.color', 'Color') }}</span>
            <UColorPicker
              :model-value="String((clip as TimelineTextClipItem).style?.color ?? '#ffffff')"
              format="hex"
              size="sm"
              @update:model-value="(v: any) => handleUpdateTextStyle({ color: String(v) })"
            />
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-ui-text-muted">{{
              t('fastcat.textClip.backgroundColor', 'Background')
            }}</span>
            <UColorPicker
              :model-value="String((clip as TimelineTextClipItem).style?.backgroundColor ?? '')"
              format="hex"
              size="sm"
              @update:model-value="
                (v: any) => handleUpdateTextStyle({ backgroundColor: String(v) })
              "
            />
          </div>
        </div>

        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-ui-text-muted">{{
            t('fastcat.textClip.width', 'Text width (0 - auto)')
          }}</span>
          <WheelNumberInput
            :model-value="Number((clip as TimelineTextClipItem).style?.width ?? 0)"
            size="sm"
            :step="10"
            :min="0"
            @update:model-value="
              (v: any) => handleUpdateTextStyle({ width: v > 0 ? Number(v) : undefined })
            "
          />
        </div>

        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-ui-text-muted">{{ t('fastcat.textClip.align', 'Align') }}</span>
          <USelectMenu
            :model-value="String((clip as TimelineTextClipItem).style?.align ?? 'center')"
            :items="[
              { value: 'left', label: 'Left' },
              { value: 'center', label: 'Center' },
              { value: 'right', label: 'Right' },
            ]"
            value-key="value"
            label-key="label"
            size="sm"
            @update:model-value="(v: any) => handleUpdateTextStyle({ align: v })"
          />
        </div>

        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-ui-text-muted">{{
            t('fastcat.textClip.verticalAlign', 'Vertical align')
          }}</span>
          <USelectMenu
            :model-value="String((clip as TimelineTextClipItem).style?.verticalAlign ?? 'middle')"
            :items="[
              { value: 'top', label: 'Top' },
              { value: 'middle', label: 'Middle' },
              { value: 'bottom', label: 'Bottom' },
            ]"
            value-key="value"
            label-key="label"
            size="sm"
            @update:model-value="(v: any) => handleUpdateTextStyle({ verticalAlign: v })"
          />
        </div>

        <div class="grid grid-cols-2 gap-2">
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-ui-text-muted">{{
              t('fastcat.textClip.lineHeight', 'Line height')
            }}</span>
            <WheelNumberInput
              :model-value="Number((clip as TimelineTextClipItem).style?.lineHeight ?? 1.2)"
              size="sm"
              :step="0.1"
              @update:model-value="(v: any) => handleUpdateTextStyle({ lineHeight: Number(v) })"
            />
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-ui-text-muted">{{
              t('fastcat.textClip.letterSpacing', 'Letter spacing')
            }}</span>
            <WheelNumberInput
              :model-value="Number((clip as TimelineTextClipItem).style?.letterSpacing ?? 0)"
              size="sm"
              :step="1"
              @update:model-value="(v: any) => handleUpdateTextStyle({ letterSpacing: Number(v) })"
            />
          </div>
        </div>

        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-ui-text-muted">{{
            t('fastcat.textClip.padding', 'Padding')
          }}</span>
          <WheelNumberInput
            :model-value="
              (() => {
                const p = (clip as TimelineTextClipItem).style?.padding;
                if (typeof p === 'number' && Number.isFinite(p)) return p;
                if (p && typeof p === 'object') {
                  if ('top' in p) return p.top ?? 60;
                  if ('x' in p || 'y' in p) return ('y' in p ? p.y : p.x) ?? 60;
                }
                return 60;
              })()
            "
            size="sm"
            :step="1"
            :min="0"
            @update:model-value="(v: any) => handleUpdateTextStyle({ padding: Number(v) })"
          />
        </div>
      </div>
    </PropertySection>

    <PropertySection
      v-else-if="clip.clipType === 'shape'"
      :title="t('fastcat.shapeClip.shape', 'Shape')"
    >
      <div class="flex flex-col gap-2">
        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-ui-text-muted">{{ t('fastcat.shapeClip.type', 'Type') }}</span>
          <USelectMenu
            :model-value="String((clip as any).shapeType ?? 'square')"
            :items="[
              { value: 'square', label: t('fastcat.shapeClip.types.square', 'Square') },
              { value: 'circle', label: t('fastcat.shapeClip.types.circle', 'Circle') },
              {
                value: 'triangle',
                label: t('fastcat.shapeClip.types.triangle', 'Triangle'),
              },
              { value: 'star', label: t('fastcat.shapeClip.types.star', 'Star') },
              { value: 'bang', label: t('fastcat.shapeClip.types.bang', 'Bang') },
              { value: 'cloud', label: t('fastcat.shapeClip.types.cloud', 'Cloud') },
              {
                value: 'speech_bubble',
                label: t('fastcat.shapeClip.types.speechBubble', 'Speech Bubble'),
              },
            ]"
            value-key="value"
            label-key="label"
            size="sm"
            @update:model-value="(v: any) => handleUpdateShapeType(v?.value ?? v)"
          />
        </div>

        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-ui-text-muted">{{
            t('fastcat.shapeClip.fillColor', 'Fill Color')
          }}</span>
          <UColorPicker
            :model-value="String((clip as any).fillColor ?? '#ffffff')"
            format="hex"
            size="sm"
            @update:model-value="(v: any) => handleUpdateFillColor(String(v))"
          />
        </div>

        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-ui-text-muted">{{
            t('fastcat.shapeClip.strokeColor', 'Stroke Color')
          }}</span>
          <UColorPicker
            :model-value="String((clip as any).strokeColor ?? '#000000')"
            format="hex"
            size="sm"
            @update:model-value="(v: any) => handleUpdateStrokeColor(String(v))"
          />
        </div>

        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-ui-text-muted">{{
            t('fastcat.shapeClip.strokeWidth', 'Stroke Width')
          }}</span>
          <WheelNumberInput
            :model-value="Number((clip as any).strokeWidth ?? 0)"
            size="sm"
            :step="1"
            :min="0"
            @update:model-value="(v: any) => handleUpdateStrokeWidth(Number(v))"
          />
        </div>

        <!-- Shape specific config -->
        <template v-if="(clip as any).shapeType === 'circle'">
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-ui-text-muted">Squash X (%)</span>
            <WheelNumberInput
              :model-value="Number((clip as any).shapeConfig?.squashX ?? 0)"
              size="sm"
              :step="1"
              @update:model-value="(v: any) => handleUpdateShapeConfig({ squashX: Number(v) })"
            />
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-ui-text-muted">Squash Y (%)</span>
            <WheelNumberInput
              :model-value="Number((clip as any).shapeConfig?.squashY ?? 0)"
              size="sm"
              :step="1"
              @update:model-value="(v: any) => handleUpdateShapeConfig({ squashY: Number(v) })"
            />
          </div>
        </template>

        <template v-else-if="(clip as any).shapeType === 'square'">
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-ui-text-muted">Width (%)</span>
            <WheelNumberInput
              :model-value="Number((clip as any).shapeConfig?.width ?? 100)"
              size="sm"
              :step="1"
              @update:model-value="(v: any) => handleUpdateShapeConfig({ width: Number(v) })"
            />
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-ui-text-muted">Height (%)</span>
            <WheelNumberInput
              :model-value="Number((clip as any).shapeConfig?.height ?? 100)"
              size="sm"
              :step="1"
              @update:model-value="(v: any) => handleUpdateShapeConfig({ height: Number(v) })"
            />
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-ui-text-muted">Corner Radius (%)</span>
            <WheelNumberInput
              :model-value="Number((clip as any).shapeConfig?.cornerRadius ?? 0)"
              size="sm"
              :step="1"
              :min="0"
              :max="100"
              @update:model-value="(v: any) => handleUpdateShapeConfig({ cornerRadius: Number(v) })"
            />
          </div>
        </template>

        <template v-else-if="(clip as any).shapeType === 'triangle'">
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-ui-text-muted">Base Length (%)</span>
            <WheelNumberInput
              :model-value="Number((clip as any).shapeConfig?.baseLength ?? 100)"
              size="sm"
              :step="1"
              @update:model-value="(v: any) => handleUpdateShapeConfig({ baseLength: Number(v) })"
            />
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-ui-text-muted">Vertex Offset (%)</span>
            <WheelNumberInput
              :model-value="Number((clip as any).shapeConfig?.vertexOffset ?? 50)"
              size="sm"
              :step="1"
              @update:model-value="(v: any) => handleUpdateShapeConfig({ vertexOffset: Number(v) })"
            />
          </div>
        </template>

        <template
          v-else-if="(clip as any).shapeType === 'star' || (clip as any).shapeType === 'bang'"
        >
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-ui-text-muted">Rays</span>
            <WheelNumberInput
              :model-value="
                Number(
                  (clip as any).shapeConfig?.rays ?? ((clip as any).shapeType === 'star' ? 5 : 12),
                )
              "
              size="sm"
              :step="1"
              :min="3"
              @update:model-value="(v: any) => handleUpdateShapeConfig({ rays: Number(v) })"
            />
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-ui-text-muted">Inner Radius (%)</span>
            <WheelNumberInput
              :model-value="
                Number(
                  (clip as any).shapeConfig?.innerRadius ??
                    ((clip as any).shapeType === 'star' ? 40 : 70),
                )
              "
              size="sm"
              :step="1"
              @update:model-value="(v: any) => handleUpdateShapeConfig({ innerRadius: Number(v) })"
            />
          </div>
        </template>

        <template v-else-if="(clip as any).shapeType === 'cloud'">
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-ui-text-muted">Cloud Type</span>
            <USelectMenu
              :model-value="String((clip as any).shapeConfig?.cloudType ?? '1')"
              :items="[
                { value: '1', label: 'Type 1' },
                { value: '2', label: 'Type 2' },
              ]"
              value-key="value"
              label-key="label"
              size="sm"
              @update:model-value="
                (v: any) => handleUpdateShapeConfig({ cloudType: Number(v?.value ?? v) as 1 | 2 })
              "
            />
          </div>
        </template>

        <template v-else-if="(clip as any).shapeType === 'speech_bubble'">
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-ui-text-muted">Width (%)</span>
            <WheelNumberInput
              :model-value="Number((clip as any).shapeConfig?.width ?? 100)"
              size="sm"
              :step="1"
              @update:model-value="(v: any) => handleUpdateShapeConfig({ width: Number(v) })"
            />
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-ui-text-muted">Height (%)</span>
            <WheelNumberInput
              :model-value="Number((clip as any).shapeConfig?.height ?? 70)"
              size="sm"
              :step="1"
              @update:model-value="(v: any) => handleUpdateShapeConfig({ height: Number(v) })"
            />
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-ui-text-muted">Corner Radius (%)</span>
            <WheelNumberInput
              :model-value="Number((clip as any).shapeConfig?.cornerRadius ?? 20)"
              size="sm"
              :step="1"
              :min="0"
              :max="100"
              @update:model-value="(v: any) => handleUpdateShapeConfig({ cornerRadius: Number(v) })"
            />
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-ui-text-muted">Pointer Sharpness (%)</span>
            <WheelNumberInput
              :model-value="Number((clip as any).shapeConfig?.pointerSharpness ?? 40)"
              size="sm"
              :step="1"
              @update:model-value="
                (v: any) => handleUpdateShapeConfig({ pointerSharpness: Number(v) })
              "
            />
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-ui-text-muted">Pointer Angle (%)</span>
            <WheelNumberInput
              :model-value="Number((clip as any).shapeConfig?.pointerAngle ?? 20)"
              size="sm"
              :step="1"
              @update:model-value="(v: any) => handleUpdateShapeConfig({ pointerAngle: Number(v) })"
            />
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-ui-text-muted">Pointer Position X (%)</span>
            <WheelNumberInput
              :model-value="Number((clip as any).shapeConfig?.pointerX ?? 30)"
              size="sm"
              :step="1"
              @update:model-value="(v: any) => handleUpdateShapeConfig({ pointerX: Number(v) })"
            />
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-ui-text-muted">Pointer Direction</span>
            <USelectMenu
              :model-value="String((clip as any).shapeConfig?.pointerDirection ?? 'left')"
              :items="[
                { value: 'left', label: 'Left' },
                { value: 'right', label: 'Right' },
              ]"
              value-key="value"
              label-key="label"
              size="sm"
              @update:model-value="
                (v: any) => handleUpdateShapeConfig({ pointerDirection: v?.value ?? v })
              "
            />
          </div>
        </template>
      </div>
    </PropertySection>

    <PropertySection v-else-if="clip.clipType === 'hud'" :title="t('fastcat.hudClip.hud', 'HUD')">
      <ParamsRenderer
        v-if="hudManifest"
        :controls="hudManifest.controls"
        :values="hudControlValues"
        @update:value="handleUpdateHudControl"
      />
    </PropertySection>

    <ClipTransitionsSection
      :is-video-track="isVideoTrack"
      :transition-in="(clip as any).transitionIn ?? null"
      :transition-out="(clip as any).transitionOut ?? null"
      :clip-duration-us="clip.timelineRange.durationUs"
      @select-edge="selectTransitionEdge"
      @toggle="toggleTransition"
      @update-duration="({ edge, durationSec }) => updateTransitionDuration(edge, durationSec)"
      @update-type="({ edge, type }) => updateTransitionType(edge, type)"
    />

    <!-- Transparency (Opacity) -->
    <div
      v-if="clip.clipType !== 'adjustment'"
      class="space-y-1.5 bg-ui-bg-elevated p-2 rounded border border-ui-border"
    >
      <div class="flex flex-col gap-0.5">
        <span class="text-xs text-ui-text-muted">{{
          t('fastcat.clip.blendMode', 'Blend mode')
        }}</span>
        <USelectMenu
          :model-value="clip.blendMode ?? 'normal'"
          :items="blendModeOptions"
          value-key="value"
          label-key="label"
          size="sm"
          @update:model-value="handleUpdateBlendMode"
        />
      </div>

      <div class="flex items-center justify-between">
        <span class="text-xs font-semibold text-ui-text uppercase tracking-wide">
          {{ t('fastcat.clip.opacity', 'Opacity') }}
        </span>
        <span class="text-xs font-mono text-ui-text-muted"
          >{{ Math.round((clip.opacity ?? 1) * 100) }}%</span
        >
      </div>
      <WheelSlider
        :model-value="clip.opacity ?? 1"
        :min="0"
        :max="1"
        :step="0.01"
        :default-value="1"
        @update:model-value="handleUpdateOpacity"
      />
    </div>

    <div ref="effectsSectionRef">
      <EffectsEditor
        :effects="clipVideoEffects"
        :title="t('fastcat.effects.clipTitle', 'Clip effects')"
        :add-label="t('fastcat.effects.add', 'Add')"
        :empty-label="t('fastcat.effects.empty', 'No effects')"
        @update:effects="handleUpdateClipEffects"
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

    <AudioEffectsEditor
      v-if="canEditAudioEffects"
      :effects="clipAudioEffects"
      @update:effects="handleUpdateClipAudioEffects"
    />

    <!-- Transform -->
    <div
      v-if="canEditTransform || canEditReversed"
      class="space-y-4 bg-ui-bg-elevated p-4 rounded-lg border border-ui-border"
    >
      <div
        class="text-xs font-semibold text-ui-text uppercase tracking-wide border-b border-ui-border pb-2"
      >
        {{ t('fastcat.clip.transform.title', 'Transform') }}
      </div>

      <div v-if="canEditReversed" class="flex items-center justify-between">
        <span class="text-sm text-ui-text">{{
          t('fastcat.clip.reversed', 'Reverse Playback')
        }}</span>
        <USwitch :model-value="isReversed" @update:model-value="toggleReversed" />
      </div>

      <div v-if="canEditTransform" class="space-y-4">
        <div class="grid grid-cols-2 gap-4">
          <UButton
            icon="i-heroicons-arrows-right-left"
            size="2xs"
            color="neutral"
            variant="ghost"
            class="text-ui-text-muted hover:text-ui-text"
            :title="t('fastcat.clip.transform.flipHorizontal', 'Flip Horizontal')"
            @click="toggleFlipHorizontal"
          />
          <UButton
            icon="i-heroicons-arrows-up-down"
            size="2xs"
            color="neutral"
            variant="ghost"
            class="text-ui-text-muted hover:text-ui-text"
            :title="t('fastcat.clip.transform.flipVertical', 'Flip Vertical')"
            @click="toggleFlipVertical"
          />
        </div>
      </div>

      <div class="grid grid-cols-[1fr_auto_1fr] gap-2 items-end">
        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-ui-text-muted">{{
            transformScaleLinked
              ? t('fastcat.clip.transform.scale', 'Scale (%)')
              : t('fastcat.clip.transform.scaleX', 'Scale X (%)')
          }}</span>
          <WheelNumberInput v-model="transformScaleX" size="sm" :step="1" />
        </div>

        <div class="flex items-center justify-center pb-1">
          <UButton
            :icon="transformScaleLinked ? 'i-heroicons-link' : 'i-heroicons-link-slash'"
            size="2xs"
            color="neutral"
            variant="ghost"
            :class="[transformScaleLinked ? 'text-ui-primary' : 'text-ui-text-muted']"
            @click="transformScaleLinked = !transformScaleLinked"
          />
        </div>

        <div v-if="!transformScaleLinked" class="flex flex-col gap-0.5">
          <span class="text-xs text-ui-text-muted">{{
            t('fastcat.clip.transform.scaleY', 'Scale Y (%)')
          }}</span>
          <WheelNumberInput v-model="transformScaleY" size="sm" :step="1" />
        </div>
        <div v-else class="flex flex-col gap-0.5">
          <!-- Placeholder to keep layout stable when linked -->
        </div>
      </div>

      <div class="flex flex-col gap-0.5">
        <span class="text-xs text-ui-text-muted">{{
          t('fastcat.clip.transform.rotation', 'Rotation (deg)')
        }}</span>
        <WheelNumberInput v-model="transformRotationDeg" size="sm" :step="1" />
      </div>

      <div class="grid grid-cols-2 gap-2">
        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-ui-text-muted">{{
            t('fastcat.clip.transform.positionX', 'Position X (px)')
          }}</span>
          <WheelNumberInput v-model="transformPosX" size="sm" :step="1" />
        </div>
        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-ui-text-muted">{{
            t('fastcat.clip.transform.positionY', 'Position Y (px)')
          }}</span>
          <WheelNumberInput v-model="transformPosY" size="sm" :step="1" />
        </div>
      </div>

      <div class="flex flex-col gap-0.5">
        <span class="text-xs text-ui-text-muted">{{
          t('fastcat.clip.transform.anchor', 'Anchor')
        }}</span>
        <USelectMenu
          v-model="transformAnchorPreset"
          :items="anchorPresetOptions"
          value-key="value"
          label-key="label"
          size="sm"
          class="w-full"
        />
      </div>

      <div v-if="transformAnchorPreset === 'custom'" class="grid grid-cols-2 gap-2">
        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-ui-text-muted">{{
            t('fastcat.clip.transform.anchorX', 'Anchor X (0..1)')
          }}</span>
          <WheelNumberInput v-model="transformAnchorX" size="sm" :step="0.01" />
        </div>
        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-ui-text-muted">{{
            t('fastcat.clip.transform.anchorY', 'Anchor Y (0..1)')
          }}</span>
          <WheelNumberInput v-model="transformAnchorY" size="sm" :step="0.01" />
        </div>
      </div>
    </div>

    <!-- Rename Modal -->
    <RenameModal
      v-model:open="isRenameModalOpen"
      :title="t('fastcat.preview.renameClip', 'Rename clip')"
      :current-name="clip.name"
      @rename="handleRenameClip"
    />
  </div>
</template>
