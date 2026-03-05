<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { useMediaStore } from '~/stores/media.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useEditorViewStore } from '~/stores/editorView.store';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import type { TimelineClipItem, TimelineTrack, TrackKind } from '~/timeline/types';
import WheelSlider from '~/components/ui/WheelSlider.vue';
import WheelNumberInput from '~/components/ui/WheelNumberInput.vue';
import EffectsEditor from '~/components/common/EffectsEditor.vue';
import RenameModal from '~/components/common/RenameModal.vue';
import TimecodeInput from '~/components/common/TimecodeInput.vue';
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyRow from '~/components/properties/PropertyRow.vue';
import ClipAudioSection from '~/components/properties/clip/ClipAudioSection.vue';
import ClipTransitionsSection from '~/components/properties/clip/ClipTransitionsSection.vue';
import { useClipTransform } from '~/composables/properties/useClipTransform';
import { useClipAudio } from '~/composables/properties/useClipAudio';
import { formatAudioChannels } from '~/utils/audio';

const props = defineProps<{
  clip: TimelineClipItem;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();
const projectStore = useProjectStore();
const mediaStore = useMediaStore();
const selectionStore = useSelectionStore();
const editorViewStore = useEditorViewStore();
const fileManager = useFileManager();
const uiStore = useUiStore();
const focusStore = useFocusStore();

const isRenameModalOpen = ref(false);

const clipRef = computed(() => props.clip);

const clipTrack = computed<TimelineTrack | undefined>(() =>
  timelineStore.timelineDoc?.tracks.find((t) => t.id === props.clip.trackId),
);

const clipTrackKind = computed<TrackKind>(() => clipTrack.value?.kind ?? 'video');

const isVideoTrack = computed(() => clipTrackKind.value === 'video');

function handleDeleteClip() {
  timelineStore.deleteSelectedItems(props.clip.trackId);
}

function toggleAudioWaveformMode() {
  const current = (props.clip as import('~/timeline/types').TimelineClipItem).audioWaveformMode || 'half';
  timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, {
    audioWaveformMode: current === 'half' ? 'full' : 'half',
  });
}

function toggleShowWaveform() {
  const current = (props.clip as import('~/timeline/types').TimelineClipItem).showWaveform !== false;
  timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, {
    showWaveform: !current,
  });
}

function selectTransitionEdge(edge: 'in' | 'out') {
  const clip = props.clip;
  timelineStore.selectTransition({ trackId: clip.trackId, itemId: clip.id, edge });
  selectionStore.selectTimelineTransition(clip.trackId, clip.id, edge);
}

function handleRenameClip(newName: string) {
  if (newName.trim()) {
    timelineStore.renameItem(props.clip.trackId, props.clip.id, newName.trim());
  }
}

async function handleSelectInFileManager() {
  if (props.clip.clipType !== 'media' || !props.clip.source?.path) return;
  const path = props.clip.source.path;

  // Switch to files view so the file manager is visible
  if (editorViewStore.currentView !== 'files' && editorViewStore.currentView !== 'cut') {
    editorViewStore.goToFiles();
  }

  // Make sure the file manager has up-to-date entries before trying to select.
  await fileManager.loadProjectDirectory();

  // Expand parent directories so the item becomes visible in the tree.
  const parts = path.split('/').filter(Boolean);
  let currentPath = '';
  for (let i = 0; i < parts.length - 1; i += 1) {
    const p = parts[i];
    if (!p) continue;
    currentPath = currentPath ? `${currentPath}/${p}` : p;
    const dirEntry = fileManager.findEntryByPath(currentPath);
    if (dirEntry && dirEntry.kind === 'directory' && !dirEntry.expanded) {
      await fileManager.toggleDirectory(dirEntry);
    }
  }

  const entry = fileManager.findEntryByPath(path);
  if (!entry) return;

  uiStore.selectedFsEntry = {
    kind: entry.kind,
    name: entry.name,
    path: entry.path,
    handle: entry.handle,
  };
  selectionStore.selectFsEntry(entry);
  focusStore.setTempFocus('left');
}

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

function handleUpdateClipEffects(effects: any[]) {
  timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, {
    effects: effects as any,
  });
}

function handleUpdateBackgroundColor(val: string | undefined) {
  if (props.clip.clipType !== 'background') return;
  const safe = typeof val === 'string' && val.trim().length > 0 ? val.trim() : '#000000';
  timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, {
    backgroundColor: safe,
  });
}

function handleUpdateText(val: string | undefined) {
  if (props.clip.clipType !== 'text') return;
  timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, {
    text: typeof val === 'string' ? val : '',
  });
}

function handleUpdateTextStyle(patch: Partial<import('~/timeline/types').TextClipStyle>) {
  if (props.clip.clipType !== 'text') return;
  const curr = ((props.clip as any).style ?? {}) as import('~/timeline/types').TextClipStyle;
  timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, {
    style: {
      ...curr,
      ...patch,
    },
  });
}

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

const {
  audioBalance,
  audioFadeInMaxSec,
  audioFadeInSec,
  audioFadeOutMaxSec,
  audioFadeOutSec,
  audioGain,
  canEditAudioBalance,
  canEditAudioFades,
  canEditAudioGain,
  selectedClipTrack,
  updateAudioBalance,
  updateAudioFadeInSec,
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

function handleTransitionUpdate(payload: {
  trackId: string;
  itemId: string;
  edge: 'in' | 'out';
  transition: import('~/timeline/types').ClipTransition | null;
}) {
  if (payload.edge === 'in') {
    timelineStore.updateClipTransition(payload.trackId, payload.itemId, {
      transitionIn: payload.transition,
    });
  } else {
    timelineStore.updateClipTransition(payload.trackId, payload.itemId, {
      transitionOut: payload.transition,
    });
  }
}

function toggleTransition(edge: 'in' | 'out') {
  const clip = props.clip;
  const current = edge === 'in' ? (clip as any).transitionIn : (clip as any).transitionOut;

  if (current) {
    handleTransitionUpdate({ trackId: clip.trackId, itemId: clip.id, edge, transition: null });
  } else {
    const defaultDurationUs = Math.max(
      0,
      Math.round(Number(projectStore.projectSettings?.transitions?.defaultDurationUs ?? 2_000_000)),
    );
    const clipDurationUs = Math.max(0, Math.round(Number(clip.timelineRange?.durationUs ?? 0)));
    const suggestedDurationUs =
      clipDurationUs > 0 && clipDurationUs < defaultDurationUs
        ? Math.round(clipDurationUs * 0.3)
        : defaultDurationUs;

    const transition = {
      type: 'dissolve',
      durationUs: suggestedDurationUs,
      mode: 'blend' as const,
      curve: 'linear' as const,
    };
    handleTransitionUpdate({ trackId: clip.trackId, itemId: clip.id, edge, transition });
    timelineStore.selectTransition({ trackId: clip.trackId, itemId: clip.id, edge });
  }
}

function updateTransitionDuration(edge: 'in' | 'out', durationSec: number) {
  const clip = props.clip;
  const current = (
    edge === 'in' ? (clip as any).transitionIn : (clip as any).transitionOut
  ) as import('~/timeline/types').ClipTransition;
  if (!current) return;

  handleTransitionUpdate({
    trackId: clip.trackId,
    itemId: clip.id,
    edge,
    transition: {
      ...current,
      durationUs: Math.round(durationSec * 1_000_000),
    },
  });
}

defineExpose({
  isRenameModalOpen,
  handleDeleteClip,
});
</script>

<template>
  <div class="w-full flex flex-col gap-2 text-ui-text">
    <PropertySection :title="t('granVideoEditor.clip.actions', 'Actions')">
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
        v-if="clip.clipType === 'media'"
        size="xs"
        variant="soft"
        color="neutral"
        icon="i-heroicons-folder-open"
        class="w-full justify-center mt-2"
        @click="handleSelectInFileManager"
      >
        {{ t('granVideoEditor.clip.showInFileManager', 'Show in File Manager') }}
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
              ? t('granVideoEditor.clip.showWaveform', 'Show Waveform')
              : t('granVideoEditor.clip.hideWaveform', 'Hide Waveform')
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
              ? t('granVideoEditor.clip.halfWaveform', 'Half Waveform')
              : t('granVideoEditor.clip.fullWaveform', 'Full Waveform')
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

    <PropertySection :title="t('granVideoEditor.clip.info', 'Clip Info')">
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
      :title="t('granVideoEditor.textClip.text', 'Text')"
    >
      <div class="flex flex-col gap-2">
        <UTextarea
          :model-value="(clip as any).text"
          size="sm"
          :rows="4"
          @update:model-value="handleUpdateText"
        />

        <div class="grid grid-cols-2 gap-2">
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-ui-text-muted">{{
              t('granVideoEditor.textClip.fontSize', 'Font size')
            }}</span>
            <WheelNumberInput
              :model-value="Number((clip as any).style?.fontSize ?? 64)"
              size="sm"
              :step="1"
              :min="1"
              @update:model-value="(v: any) => handleUpdateTextStyle({ fontSize: Number(v) })"
            />
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-ui-text-muted">{{ t('common.color', 'Color') }}</span>
            <UColorPicker
              :model-value="String((clip as any).style?.color ?? '#ffffff')"
              format="hex"
              size="sm"
              @update:model-value="(v: any) => handleUpdateTextStyle({ color: String(v) })"
            />
          </div>
        </div>

        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-ui-text-muted">{{
            t('granVideoEditor.textClip.width', 'Text width (0 - auto)')
          }}</span>
          <WheelNumberInput
            :model-value="Number((clip as any).style?.width ?? 0)"
            size="sm"
            :step="10"
            :min="0"
            @update:model-value="
              (v: any) => handleUpdateTextStyle({ width: v > 0 ? Number(v) : undefined })
            "
          />
        </div>

        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-ui-text-muted">{{
            t('granVideoEditor.textClip.align', 'Align')
          }}</span>
          <USelectMenu
            :model-value="String((clip as any).style?.align ?? 'center')"
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
            t('granVideoEditor.textClip.verticalAlign', 'Vertical align')
          }}</span>
          <USelectMenu
            :model-value="String((clip as any).style?.verticalAlign ?? 'middle')"
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
              t('granVideoEditor.textClip.lineHeight', 'Line height')
            }}</span>
            <WheelNumberInput
              :model-value="Number((clip as any).style?.lineHeight ?? 1.2)"
              size="sm"
              :step="0.1"
              @update:model-value="(v: any) => handleUpdateTextStyle({ lineHeight: Number(v) })"
            />
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-ui-text-muted">{{
              t('granVideoEditor.textClip.letterSpacing', 'Letter spacing')
            }}</span>
            <WheelNumberInput
              :model-value="Number((clip as any).style?.letterSpacing ?? 0)"
              size="sm"
              :step="1"
              @update:model-value="(v: any) => handleUpdateTextStyle({ letterSpacing: Number(v) })"
            />
          </div>
        </div>

        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-ui-text-muted">{{
            t('granVideoEditor.textClip.backgroundColor', 'Background')
          }}</span>
          <UColorPicker
            :model-value="String((clip as any).style?.backgroundColor ?? '')"
            format="hex"
            size="sm"
            @update:model-value="(v: any) => handleUpdateTextStyle({ backgroundColor: String(v) })"
          />
        </div>

        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-ui-text-muted">{{
            t('granVideoEditor.textClip.padding', 'Padding')
          }}</span>
          <WheelNumberInput
            :model-value="
              (() => {
                const p = (clip as any).style?.padding;
                if (typeof p === 'number' && Number.isFinite(p)) return p;
                if (p && typeof p === 'object') return p.top ?? p.x ?? p.y ?? 60;
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

    <ClipTransitionsSection
      :is-video-track="isVideoTrack"
      :transition-in="(clip as any).transitionIn ?? null"
      :transition-out="(clip as any).transitionOut ?? null"
      :clip-duration-us="clip.timelineRange.durationUs"
      @select-edge="selectTransitionEdge"
      @toggle="toggleTransition"
      @update-duration="({ edge, durationSec }) => updateTransitionDuration(edge, durationSec)"
    />

    <!-- Transparency (Opacity) -->
    <div
      v-if="clip.clipType !== 'adjustment'"
      class="space-y-1.5 bg-ui-bg-elevated p-2 rounded border border-ui-border"
    >
      <div class="flex items-center justify-between">
        <span class="text-xs font-semibold text-ui-text uppercase tracking-wide">
          {{ t('granVideoEditor.clip.opacity', 'Opacity') }}
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
        :effects="clip.effects"
        :title="t('granVideoEditor.effects.clipTitle', 'Clip effects')"
        :add-label="t('granVideoEditor.effects.add', 'Add')"
        :empty-label="t('granVideoEditor.effects.empty', 'No effects')"
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
      @update-audio-gain="updateAudioGain"
      @update-audio-balance="updateAudioBalance"
      @update-audio-fade-in-sec="updateAudioFadeInSec"
      @update-audio-fade-out-sec="updateAudioFadeOutSec"
    />

    <!-- Transform -->
    <div
      v-if="canEditTransform"
      class="space-y-2 bg-ui-bg-elevated p-2 rounded border border-ui-border"
    >
      <div
        class="flex items-center justify-between text-xs font-semibold text-ui-text uppercase tracking-wide border-b border-ui-border pb-1"
      >
        <span>{{ t('granVideoEditor.clip.transform.title', 'Transform') }}</span>
        <div class="flex items-center gap-1">
          <UButton
            icon="i-heroicons-arrows-right-left"
            size="2xs"
            color="neutral"
            variant="ghost"
            class="text-ui-text-muted hover:text-ui-text"
            :title="t('granVideoEditor.clip.transform.flipHorizontal', 'Flip Horizontal')"
            @click="toggleFlipHorizontal"
          />
          <UButton
            icon="i-heroicons-arrows-up-down"
            size="2xs"
            color="neutral"
            variant="ghost"
            class="text-ui-text-muted hover:text-ui-text"
            :title="t('granVideoEditor.clip.transform.flipVertical', 'Flip Vertical')"
            @click="toggleFlipVertical"
          />
        </div>
      </div>

      <div class="grid grid-cols-[1fr_auto_1fr] gap-2 items-end">
        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-ui-text-muted">{{
            transformScaleLinked
              ? t('granVideoEditor.clip.transform.scale', 'Scale (%)')
              : t('granVideoEditor.clip.transform.scaleX', 'Scale X (%)')
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
            t('granVideoEditor.clip.transform.scaleY', 'Scale Y (%)')
          }}</span>
          <WheelNumberInput v-model="transformScaleY" size="sm" :step="1" />
        </div>
        <div v-else class="flex flex-col gap-0.5">
          <!-- Placeholder to keep layout stable when linked -->
        </div>
      </div>

      <div class="flex flex-col gap-0.5">
        <span class="text-xs text-ui-text-muted">{{
          t('granVideoEditor.clip.transform.rotation', 'Rotation (deg)')
        }}</span>
        <WheelNumberInput v-model="transformRotationDeg" size="sm" :step="1" />
      </div>

      <div class="grid grid-cols-2 gap-2">
        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-ui-text-muted">{{
            t('granVideoEditor.clip.transform.positionX', 'Position X (px)')
          }}</span>
          <WheelNumberInput v-model="transformPosX" size="sm" :step="1" />
        </div>
        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-ui-text-muted">{{
            t('granVideoEditor.clip.transform.positionY', 'Position Y (px)')
          }}</span>
          <WheelNumberInput v-model="transformPosY" size="sm" :step="1" />
        </div>
      </div>

      <div class="flex flex-col gap-0.5">
        <span class="text-xs text-ui-text-muted">{{
          t('granVideoEditor.clip.transform.anchor', 'Anchor')
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
            t('granVideoEditor.clip.transform.anchorX', 'Anchor X (0..1)')
          }}</span>
          <WheelNumberInput v-model="transformAnchorX" size="sm" :step="0.01" />
        </div>
        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-ui-text-muted">{{
            t('granVideoEditor.clip.transform.anchorY', 'Anchor Y (0..1)')
          }}</span>
          <WheelNumberInput v-model="transformAnchorY" size="sm" :step="0.01" />
        </div>
      </div>
    </div>

    <!-- Rename Modal -->
    <RenameModal
      v-model:open="isRenameModalOpen"
      :title="t('granVideoEditor.preview.renameClip', 'Rename clip')"
      :current-name="clip.name"
      @rename="handleRenameClip"
    />
  </div>
</template>
