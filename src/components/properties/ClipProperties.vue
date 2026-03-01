<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useMediaStore } from '~/stores/media.store';
import { useSelectionStore } from '~/stores/selection.store';
import type { TimelineClipItem, TimelineTrack } from '~/timeline/types';
import WheelSlider from '~/components/ui/WheelSlider.vue';
import EffectsEditor from '~/components/common/EffectsEditor.vue';
import DurationSliderInput from '~/components/ui/DurationSliderInput.vue';
import RenameModal from '~/components/common/RenameModal.vue';
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyRow from '~/components/properties/PropertyRow.vue';
import { formatDurationSeconds } from '~/utils/format';

const props = defineProps<{
  clip: TimelineClipItem;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();
const mediaStore = useMediaStore();
const selectionStore = useSelectionStore();

const isRenameModalOpen = ref(false);

const selectedClipTrack = computed<TimelineTrack | null>(() => {
  return (
    (timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined)?.find(
      (t) => t.id === props.clip.trackId,
    ) ?? null
  );
});

function handleDeleteClip() {
  timelineStore.deleteSelectedItems(props.clip.trackId);
}

function handleRenameClip(newName: string) {
  if (newName.trim()) {
    timelineStore.renameItem(props.clip.trackId, props.clip.id, newName.trim());
  }
}

async function handleSelectInFileManager() {
  if (props.clip.clipType !== 'media' || !props.clip.source?.path) return;
  const path = props.clip.source.path;
  
  // Use file manager to select
  const { useFileManager } = await import('~/composables/fileManager/useFileManager');
  const fm = useFileManager();
  const entry = await fm.findEntryByPath(path);
  
  if (entry) {
    selectionStore.selectFsEntry(entry);
  }
}

const mediaMeta = computed(() => {
  if (props.clip.clipType !== 'media' || !props.clip.source?.path) return null;
  return mediaStore.mediaMetadata[props.clip.source.path] || null;
});

function formatAudioChannels(channels: number | undefined) {
  if (!channels || channels <= 0) return '-';
  if (channels === 1) return 'Mono';
  if (channels === 2) return 'Stereo';
  return `${channels} tracks`;
}

function handleUpdateStartTime(val: number | string) {
  const newStartUs = Math.max(0, Math.round(Number(val) * 1_000_000));
  if (newStartUs === props.clip.timelineRange.startUs) return;
  
  timelineStore.applyTimeline({
    type: 'move_item',
    trackId: props.clip.trackId,
    itemId: props.clip.id,
    startUs: newStartUs,
  });
}

function handleUpdateEndTime(val: number | string) {
  const newEndUs = Math.max(0, Math.round(Number(val) * 1_000_000));
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

function handleUpdateAudioGain(val: unknown) {
  const v = typeof val === 'number' && Number.isFinite(val) ? val : Number(val);
  const safe = Number.isFinite(v) ? Math.max(0, Math.min(2, v)) : 1;
  timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, {
    audioGain: safe,
  });
}

function handleUpdateAudioBalance(val: unknown) {
  const v = typeof val === 'number' && Number.isFinite(val) ? val : Number(val);
  const safe = Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
  timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, {
    audioBalance: safe,
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

function clampNumber(value: unknown, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(min, Math.min(max, n));
}

function getSafeTransform(clip: TimelineClipItem): import('~/timeline/types').ClipTransform {
  const tr = (clip as any).transform ?? {};
  const scaleRaw = tr.scale ?? {};
  const scaleX = typeof scaleRaw.x === 'number' && Number.isFinite(scaleRaw.x) ? scaleRaw.x : 1;
  const scaleY = typeof scaleRaw.y === 'number' && Number.isFinite(scaleRaw.y) ? scaleRaw.y : 1;
  const linked = Boolean(scaleRaw.linked);

  const positionRaw = tr.position ?? {};
  const posX =
    typeof positionRaw.x === 'number' && Number.isFinite(positionRaw.x) ? positionRaw.x : 0;
  const posY =
    typeof positionRaw.y === 'number' && Number.isFinite(positionRaw.y) ? positionRaw.y : 0;

  const rotationDeg =
    typeof tr.rotationDeg === 'number' && Number.isFinite(tr.rotationDeg) ? tr.rotationDeg : 0;

  const anchorRaw = tr.anchor ?? {};
  const preset =
    anchorRaw.preset === 'center' ||
    anchorRaw.preset === 'topLeft' ||
    anchorRaw.preset === 'topRight' ||
    anchorRaw.preset === 'bottomLeft' ||
    anchorRaw.preset === 'bottomRight' ||
    anchorRaw.preset === 'custom'
      ? anchorRaw.preset
      : 'center';
  const anchorX =
    typeof anchorRaw.x === 'number' && Number.isFinite(anchorRaw.x) ? anchorRaw.x : 0.5;
  const anchorY =
    typeof anchorRaw.y === 'number' && Number.isFinite(anchorRaw.y) ? anchorRaw.y : 0.5;

  return {
    scale: {
      x: clampNumber(scaleX, 0.001, 1000),
      y: clampNumber(scaleY, 0.001, 1000),
      linked,
    },
    position: {
      x: clampNumber(posX, -1_000_000, 1_000_000),
      y: clampNumber(posY, -1_000_000, 1_000_000),
    },
    rotationDeg: clampNumber(rotationDeg, -36000, 36000),
    anchor:
      preset === 'custom'
        ? { preset, x: clampNumber(anchorX, 0, 1), y: clampNumber(anchorY, 0, 1) }
        : { preset },
  };
}

function updateSelectedClipTransform(patch: Partial<import('~/timeline/types').ClipTransform>) {
  const clip = props.clip;
  const current = getSafeTransform(clip);
  const next: import('~/timeline/types').ClipTransform = {
    ...current,
    ...patch,
    scale: {
      ...(current.scale ?? { x: 1, y: 1, linked: true }),
      ...(patch.scale ?? {}),
    },
    position: {
      ...(current.position ?? { x: 0, y: 0 }),
      ...(patch.position ?? {}),
    },
    anchor: {
      ...(current.anchor ?? { preset: 'center' }),
      ...(patch.anchor ?? {}),
    },
  };

  timelineStore.updateClipProperties(clip.trackId, clip.id, {
    transform: next,
  });
}

const canEditTransform = computed(() => {
  return props.clip.trackId.startsWith('v');
});

const anchorPresetOptions = computed(() => [
  { value: 'center', label: 'Center' },
  { value: 'topLeft', label: 'Top Left' },
  { value: 'topRight', label: 'Top Right' },
  { value: 'bottomLeft', label: 'Bottom Left' },
  { value: 'bottomRight', label: 'Bottom Right' },
  { value: 'custom', label: 'Custom' },
]);

const transformScaleLinked = computed({
  get: () => {
    return Boolean(getSafeTransform(props.clip).scale?.linked);
  },
  set: (val: boolean) => {
    const current = getSafeTransform(props.clip);
    const linked = Boolean(val);
    const x = current.scale?.x ?? 1;
    const y = current.scale?.y ?? 1;
    updateSelectedClipTransform({
      scale: linked ? { x, y: x, linked } : { x, y, linked },
    });
  },
});

const transformScaleX = computed({
  get: () => {
    return getSafeTransform(props.clip).scale?.x ?? 1;
  },
  set: (val: number) => {
    const current = getSafeTransform(props.clip);
    const linked = Boolean(current.scale?.linked);
    const x = clampNumber(val, 0.001, 1000);
    const y = linked ? x : (current.scale?.y ?? 1);
    updateSelectedClipTransform({ scale: { x, y, linked } });
  },
});

const transformScaleY = computed({
  get: () => {
    return getSafeTransform(props.clip).scale?.y ?? 1;
  },
  set: (val: number) => {
    const current = getSafeTransform(props.clip);
    const linked = Boolean(current.scale?.linked);
    const y = clampNumber(val, 0.001, 1000);
    const x = linked ? y : (current.scale?.x ?? 1);
    updateSelectedClipTransform({ scale: { x, y, linked } });
  },
});

const transformRotationDeg = computed({
  get: () => {
    return getSafeTransform(props.clip).rotationDeg ?? 0;
  },
  set: (val: number) => {
    updateSelectedClipTransform({ rotationDeg: clampNumber(val, -36000, 36000) });
  },
});

const transformPosX = computed({
  get: () => {
    return getSafeTransform(props.clip).position?.x ?? 0;
  },
  set: (val: number) => {
    const current = getSafeTransform(props.clip);
    updateSelectedClipTransform({
      position: { x: clampNumber(val, -1_000_000, 1_000_000), y: current.position?.y ?? 0 },
    });
  },
});

const transformPosY = computed({
  get: () => {
    return getSafeTransform(props.clip).position?.y ?? 0;
  },
  set: (val: number) => {
    const current = getSafeTransform(props.clip);
    updateSelectedClipTransform({
      position: { x: current.position?.x ?? 0, y: clampNumber(val, -1_000_000, 1_000_000) },
    });
  },
});

const transformAnchorPreset = computed({
  get: () => {
    return getSafeTransform(props.clip).anchor?.preset ?? 'center';
  },
  set: (val: string) => {
    if (
      val !== 'center' &&
      val !== 'topLeft' &&
      val !== 'topRight' &&
      val !== 'bottomLeft' &&
      val !== 'bottomRight' &&
      val !== 'custom'
    ) {
      return;
    }
    if (val === 'custom') {
      updateSelectedClipTransform({ anchor: { preset: 'custom', x: 0.5, y: 0.5 } });
    } else {
      updateSelectedClipTransform({ anchor: { preset: val as any } });
    }
  },
});

const transformAnchorX = computed({
  get: () => {
    return getSafeTransform(props.clip).anchor?.x ?? 0.5;
  },
  set: (val: number) => {
    const current = getSafeTransform(props.clip);
    if (current.anchor?.preset !== 'custom') return;
    updateSelectedClipTransform({
      anchor: {
        preset: 'custom',
        x: clampNumber(val, 0, 1),
        y: current.anchor?.y ?? 0.5,
      },
    });
  },
});

const transformAnchorY = computed({
  get: () => {
    return getSafeTransform(props.clip).anchor?.y ?? 0.5;
  },
  set: (val: number) => {
    const current = getSafeTransform(props.clip);
    if (current.anchor?.preset !== 'custom') return;
    updateSelectedClipTransform({
      anchor: {
        preset: 'custom',
        x: current.anchor?.x ?? 0.5,
        y: clampNumber(val, 0, 1),
      },
    });
  },
});

const canEditAudioFades = computed(() => {
  if (props.clip.clipType !== 'media' && props.clip.clipType !== 'timeline') return false;
  return true;
});

const canEditAudioGain = computed(() => {
  if (props.clip.clipType !== 'media' && props.clip.clipType !== 'timeline') return false;
  const track = timelineStore.timelineDoc?.tracks.find((t) => t.id === props.clip.trackId);
  if (track?.kind === 'video' && (props.clip as any).audioFromVideoDisabled) return false;

  if (props.clip.source?.path) {
    const meta = mediaStore.mediaMetadata[props.clip.source.path];
    if (!meta?.audio) return false;
  }

  return true;
});

const canEditAudioBalance = computed(() => {
  return canEditAudioGain.value;
});

const audioGain = computed({
  get: () => {
    const v =
      typeof (props.clip as any)?.audioGain === 'number' &&
      Number.isFinite((props.clip as any).audioGain)
        ? (props.clip as any).audioGain
        : 1;
    return Math.max(0, Math.min(2, v));
  },
  set: (val: number) => {
    const v = Math.max(0, Math.min(2, Number(val)));
    timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, { audioGain: v });
  },
});

const audioBalance = computed({
  get: () => {
    const v =
      typeof (props.clip as any)?.audioBalance === 'number' &&
      Number.isFinite((props.clip as any).audioBalance)
        ? (props.clip as any).audioBalance
        : 0;
    return Math.max(-1, Math.min(1, v));
  },
  set: (val: number) => {
    const v = Math.max(-1, Math.min(1, Number(val)));
    timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, { audioBalance: v });
  },
});

const clipDurationSec = computed(() => {
  return Math.max(0, Number(props.clip.timelineRange?.durationUs ?? 0) / 1_000_000);
});

const audioFadeInSec = computed({
  get: () => {
    const v =
      typeof (props.clip as any)?.audioFadeInUs === 'number' &&
      Number.isFinite((props.clip as any).audioFadeInUs)
        ? (props.clip as any).audioFadeInUs
        : 0;
    return Math.max(0, v / 1_000_000);
  },
  set: (val: number) => {
    const v = Math.max(0, Math.min(val, clipDurationSec.value)) * 1_000_000;
    timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, { audioFadeInUs: v });
  },
});

const audioFadeOutSec = computed({
  get: () => {
    const v =
      typeof (props.clip as any)?.audioFadeOutUs === 'number' &&
      Number.isFinite((props.clip as any).audioFadeOutUs)
        ? (props.clip as any).audioFadeOutUs
        : 0;
    return Math.max(0, v / 1_000_000);
  },
  set: (val: number) => {
    const v = Math.max(0, Math.min(val, clipDurationSec.value)) * 1_000_000;
    timelineStore.updateClipProperties(props.clip.trackId, props.clip.id, { audioFadeOutUs: v });
  },
});

const audioFadeInMaxSec = computed(() => {
  const opp =
    typeof (props.clip as any).audioFadeOutUs === 'number' &&
    Number.isFinite((props.clip as any).audioFadeOutUs)
      ? (props.clip as any).audioFadeOutUs
      : 0;
  return Math.max(0, (Number(props.clip.timelineRange?.durationUs ?? 0) - opp) / 1_000_000);
});

const audioFadeOutMaxSec = computed(() => {
  const opp =
    typeof (props.clip as any).audioFadeInUs === 'number' &&
    Number.isFinite((props.clip as any).audioFadeInUs)
      ? (props.clip as any).audioFadeInUs
      : 0;
  return Math.max(0, (Number(props.clip.timelineRange?.durationUs ?? 0) - opp) / 1_000_000);
});

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
    // Basic defaults
    const transition = {
      type: 'dissolve',
      durationUs: 1_000_000,
      mode: 'blend' as const,
      curve: 'linear' as const,
    };
    handleTransitionUpdate({ trackId: clip.trackId, itemId: clip.id, edge, transition });
    // Optionally select it right away
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

function formatTime(us: number): string {
  if (!us) return '0.00s';
  return (us / 1_000_000).toFixed(2) + 's';
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
        <PropertyRow :label="t('videoEditor.fileManager.video.fps', 'FPS')" :value="mediaMeta.video.fps ?? '-'" />
      </template>
      <template v-if="mediaMeta?.audio">
        <PropertyRow :label="t('videoEditor.fileManager.audio.channels', 'Channels')">
          {{ formatAudioChannels(mediaMeta.audio.channels) }},
          {{ mediaMeta.audio.sampleRate ? `${mediaMeta.audio.sampleRate} Hz` : '-' }}
        </PropertyRow>
      </template>
    </PropertySection>

    <PropertySection :title="t('granVideoEditor.clip.info', 'Clip Info')">
      <PropertyRow :label="t('common.duration', 'Duration')" :value="formatTime(clip.timelineRange.durationUs)" />
      
      <div class="flex flex-col gap-0.5 mt-2">
        <span class="text-xs text-ui-text-muted">{{ t('common.start', 'Start Time') }} (s)</span>
        <UInput
          :model-value="clip.timelineRange.startUs / 1_000_000"
          size="sm"
          type="number"
          step="0.01"
          @update:model-value="handleUpdateStartTime"
        />
      </div>
      
      <div class="flex flex-col gap-0.5 mt-2">
        <span class="text-xs text-ui-text-muted">{{ t('common.end', 'End Time') }} (s)</span>
        <UInput
          :model-value="(clip.timelineRange.startUs + clip.timelineRange.durationUs) / 1_000_000"
          size="sm"
          type="number"
          step="0.01"
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

    <PropertySection v-else-if="clip.clipType === 'text'" :title="t('granVideoEditor.textClip.text', 'Text')">
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
            <UInput
              :model-value="Number((clip as any).style?.fontSize ?? 64)"
              size="sm"
              type="number"
              step="1"
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
            t('granVideoEditor.textClip.align', 'Align')
          }}</span>
          <USelect
            :model-value="String((clip as any).style?.align ?? 'center')"
            :options="[
              { value: 'left', label: 'Left' },
              { value: 'center', label: 'Center' },
              { value: 'right', label: 'Right' },
            ]"
            size="sm"
            @update:model-value="(v: any) => handleUpdateTextStyle({ align: v })"
          />
        </div>

        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-ui-text-muted">{{
            t('granVideoEditor.textClip.verticalAlign', 'Vertical align')
          }}</span>
          <USelect
            :model-value="String((clip as any).style?.verticalAlign ?? 'middle')"
            :options="[
              { value: 'top', label: 'Top' },
              { value: 'middle', label: 'Middle' },
              { value: 'bottom', label: 'Bottom' },
            ]"
            size="sm"
            @update:model-value="(v: any) => handleUpdateTextStyle({ verticalAlign: v })"
          />
        </div>

        <div class="grid grid-cols-2 gap-2">
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-ui-text-muted">{{
              t('granVideoEditor.textClip.lineHeight', 'Line height')
            }}</span>
            <UInput
              :model-value="Number((clip as any).style?.lineHeight ?? 1.2)"
              size="sm"
              type="number"
              step="0.1"
              @update:model-value="(v: any) => handleUpdateTextStyle({ lineHeight: Number(v) })"
            />
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-ui-text-muted">{{
              t('granVideoEditor.textClip.letterSpacing', 'Letter spacing')
            }}</span>
            <UInput
              :model-value="Number((clip as any).style?.letterSpacing ?? 0)"
              size="sm"
              type="number"
              step="1"
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
          <UInput
            :model-value="Number((clip as any).style?.padding ?? 60)"
            size="sm"
            type="number"
            step="1"
            @update:model-value="(v: any) => handleUpdateTextStyle({ padding: Number(v) })"
          />
        </div>
      </div>
    </PropertySection>

    <!-- Quick Transitions -->
    <div
      v-if="clip.trackId.startsWith('v')"
      class="space-y-2 bg-ui-bg-elevated p-2 rounded border border-ui-border"
    >
      <div
        class="text-xs font-semibold text-ui-text uppercase tracking-wide border-b border-ui-border pb-1"
      >
        {{ t('granVideoEditor.timeline.transitions', 'Transitions') }}
      </div>

      <!-- In Transition -->
      <div class="flex flex-col gap-1 pb-1.5 border-b border-ui-border/40">
        <div class="flex items-center justify-between">
          <span class="text-[11px] font-medium text-ui-text-muted">Transition IN</span>
          <UButton
            size="xs"
            :color="(clip as any).transitionIn ? 'red' : 'primary'"
            variant="ghost"
            :icon="(clip as any).transitionIn ? 'i-heroicons-trash' : 'i-heroicons-plus-circle'"
            @click="toggleTransition('in')"
          />
        </div>
        <div
          v-if="(clip as any).transitionIn"
          class="space-y-1.5 pl-2 border-l-2 border-primary-500/40"
        >
          <div class="flex items-center justify-between">
            <UButton
              variant="link"
              color="primary"
              size="xs"
              class="p-0 h-auto font-mono text-[10px]"
              @click="
                timelineStore.selectTransition({
                  trackId: clip.trackId,
                  itemId: clip.id,
                  edge: 'in',
                })
              "
            >
              {{ (clip as any).transitionIn.type }}
            </UButton>
            <span class="text-[10px] font-mono text-ui-text-muted">
              {{ formatTime((clip as any).transitionIn.durationUs) }}
            </span>
          </div>
          <DurationSliderInput
            :model-value="(clip as any).transitionIn.durationUs / 1_000_000"
            :min="0.1"
            :max="
              Math.max(
                0.1,
                (clip.timelineRange.durationUs - ((clip as any).transitionOut?.durationUs ?? 0)) /
                  1_000_000,
              )
            "
            :step="0.01"
            unit="s"
            :decimals="2"
            @update:model-value="(v: number) => updateTransitionDuration('in', v)"
          />
        </div>
      </div>

      <!-- Out Transition -->
      <div class="flex flex-col gap-1">
        <div class="flex items-center justify-between">
          <span class="text-[11px] font-medium text-ui-text-muted">Transition OUT</span>
          <UButton
            size="xs"
            :color="(clip as any).transitionOut ? 'red' : 'primary'"
            variant="ghost"
            :icon="(clip as any).transitionOut ? 'i-heroicons-trash' : 'i-heroicons-plus-circle'"
            @click="toggleTransition('out')"
          />
        </div>
        <div
          v-if="(clip as any).transitionOut"
          class="space-y-1.5 pl-2 border-l-2 border-primary-500/40"
        >
          <div class="flex items-center justify-between">
            <UButton
              variant="link"
              color="primary"
              size="xs"
              class="p-0 h-auto font-mono text-[10px]"
              @click="
                timelineStore.selectTransition({
                  trackId: clip.trackId,
                  itemId: clip.id,
                  edge: 'out',
                })
              "
            >
              {{ (clip as any).transitionOut.type }}
            </UButton>
            <span class="text-[10px] font-mono text-ui-text-muted">
              {{ formatTime((clip as any).transitionOut.durationUs) }}
            </span>
          </div>
          <DurationSliderInput
            :model-value="(clip as any).transitionOut.durationUs / 1_000_000"
            :min="0.1"
            :max="
              Math.max(
                0.1,
                (clip.timelineRange.durationUs - ((clip as any).transitionIn?.durationUs ?? 0)) /
                  1_000_000,
              )
            "
            :step="0.01"
            unit="s"
            :decimals="2"
            @update:model-value="(v: number) => updateTransitionDuration('out', v)"
          />
        </div>
      </div>
    </div>

    <!-- Transparency (Opacity) -->
    <div
      v-if="clip.clipType !== 'adjustment'"
      class="space-y-1.5 bg-ui-bg-elevated p-2 rounded border border-ui-border"
    >
      <div class="flex items-center justify-between">
        <span class="text-xs font-semibold text-ui-text uppercase tracking-wide">Прозрачность</span>
        <span class="text-xs font-mono text-ui-text-muted"
          >{{ Math.round((clip.opacity ?? 1) * 100) }}%</span
        >
      </div>
      <WheelSlider
        :model-value="clip.opacity ?? 1"
        :min="0"
        :max="1"
        :step="0.01"
        @update:model-value="handleUpdateOpacity"
      />
    </div>

    <EffectsEditor
      :effects="clip.effects"
      :title="t('granVideoEditor.effects.clipTitle', 'Clip effects')"
      :add-label="t('granVideoEditor.effects.add', 'Add')"
      :empty-label="t('granVideoEditor.effects.empty', 'No effects')"
      @update:effects="handleUpdateClipEffects"
    />

    <div
      v-if="
        canEditAudioFades &&
        (selectedClipTrack?.kind === 'audio' || selectedClipTrack?.kind === 'video')
      "
      class="space-y-2 bg-ui-bg-elevated p-2 rounded border border-ui-border"
    >
      <div
        class="text-xs font-semibold text-ui-text uppercase tracking-wide border-b border-ui-border pb-1"
      >
        {{ t('granVideoEditor.clip.audioFade.title', 'Audio fades') }}
      </div>

      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <span class="text-xs text-ui-text-muted">{{
            t('granVideoEditor.clip.audio.volume', 'Volume')
          }}</span>
          <span class="text-xs font-mono text-ui-text-muted">{{ audioGain.toFixed(3) }}x</span>
        </div>
        <WheelSlider
          :model-value="audioGain"
          :min="0"
          :max="2"
          :step="0.001"
          @update:model-value="handleUpdateAudioGain"
        />
      </div>

      <div v-if="canEditAudioBalance" class="space-y-1.5">
        <div class="flex items-center justify-between">
          <span class="text-xs text-ui-text-muted">{{
            t('granVideoEditor.clip.audio.balance', 'Balance')
          }}</span>
          <span class="text-xs font-mono text-ui-text-muted">{{ audioBalance.toFixed(2) }}</span>
        </div>
        <WheelSlider
          :model-value="audioBalance"
          :min="-1"
          :max="1"
          :step="0.01"
          @update:model-value="handleUpdateAudioBalance"
        />
      </div>

      <div class="grid grid-cols-2 gap-2">
        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-ui-text-muted">{{
            t('granVideoEditor.clip.audioFade.in', 'Fade in')
          }}</span>
          <UInput
            v-model.number="audioFadeInSec"
            size="sm"
            type="number"
            step="0.01"
            :min="0"
            :max="audioFadeInMaxSec"
          />
        </div>
        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-ui-text-muted">{{
            t('granVideoEditor.clip.audioFade.out', 'Fade out')
          }}</span>
          <UInput
            v-model.number="audioFadeOutSec"
            size="sm"
            type="number"
            step="0.01"
            :min="0"
            :max="audioFadeOutMaxSec"
          />
        </div>
      </div>
    </div>

    <!-- Transform -->
    <div
      v-if="canEditTransform"
      class="space-y-2 bg-ui-bg-elevated p-2 rounded border border-ui-border"
    >
      <div
        class="text-xs font-semibold text-ui-text uppercase tracking-wide border-b border-ui-border pb-1"
      >
        Transform
      </div>

      <div class="grid grid-cols-2 gap-2">
        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-ui-text-muted">Scale X</span>
          <UInput v-model.number="transformScaleX" size="sm" type="number" step="0.01" />
        </div>
        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-ui-text-muted">Scale Y</span>
          <UInput v-model.number="transformScaleY" size="sm" type="number" step="0.01" />
        </div>
      </div>

      <div class="flex items-center justify-between">
        <span class="text-sm text-ui-text">Linked scale</span>
        <UCheckbox v-model="transformScaleLinked" />
      </div>

      <div class="flex flex-col gap-0.5">
        <span class="text-xs text-ui-text-muted">Rotation (deg)</span>
        <UInput v-model.number="transformRotationDeg" size="sm" type="number" step="0.1" />
      </div>

      <div class="grid grid-cols-2 gap-2">
        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-ui-text-muted">Position X</span>
          <UInput v-model.number="transformPosX" size="sm" type="number" step="1" />
        </div>
        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-ui-text-muted">Position Y</span>
          <UInput v-model.number="transformPosY" size="sm" type="number" step="1" />
        </div>
      </div>

      <div class="flex flex-col gap-0.5">
        <span class="text-xs text-ui-text-muted">Anchor</span>
        <USelect v-model="transformAnchorPreset" :options="anchorPresetOptions" size="sm" />
      </div>

      <div v-if="transformAnchorPreset === 'custom'" class="grid grid-cols-2 gap-2">
        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-ui-text-muted">Anchor X (0..1)</span>
          <UInput v-model.number="transformAnchorX" size="sm" type="number" step="0.01" />
        </div>
        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-ui-text-muted">Anchor Y (0..1)</span>
          <UInput v-model.number="transformAnchorY" size="sm" type="number" step="0.01" />
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
