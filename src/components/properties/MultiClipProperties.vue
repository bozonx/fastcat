<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyRow from '~/components/properties/PropertyRow.vue';
import type { TimelineClipItem } from '~/timeline/types';
import TimecodeInput from '~/components/common/TimecodeInput.vue';
import { sanitizeFps } from '~/timeline/commands/utils';

const props = defineProps<{
  items: { trackId: string; itemId: string }[];
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();

const generatedGroupId = () =>
  `linked-group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const selectedCountLabel = computed(() => {
  return (t as any)(
    'granVideoEditor.timeline.selectedClipsCount',
    '{count} clips selected',
    { count: props.items.length },
  ) as string;
});

const hasLockedLinks = computed(() => {
  const doc = timelineStore.timelineDoc;
  if (!doc) return false;

  const selectedIds = new Set(props.items.map((x) => x.itemId));

  for (const track of doc.tracks) {
    for (const it of track.items) {
      if (!selectedIds.has(it.id)) continue;
      if (it.kind !== 'clip') continue;
      if (track.kind === 'audio' && Boolean((it as any).linkedVideoClipId) && Boolean((it as any).lockToLinkedVideo)) {
        return true;
      }
      if (track.kind === 'video') {
        const videoId = it.id;
        const hasLinkedAudio = doc.tracks
          .filter((t) => t.kind === 'audio')
          .some((t) =>
            t.items.some(
              (a) =>
                a.kind === 'clip' &&
                Boolean((a as any).linkedVideoClipId) &&
                Boolean((a as any).lockToLinkedVideo) &&
                String((a as any).linkedVideoClipId) === videoId,
            ),
          );
        if (hasLinkedAudio) return true;
      }
    }
  }

  return false;
});

const selectedClips = computed(() => {
  const clips: TimelineClipItem[] = [];
  const doc = timelineStore.timelineDoc;
  if (!doc) return clips;
  
  for (const { trackId, itemId } of props.items) {
    const track = doc.tracks.find((t) => t.id === trackId);
    if (!track) continue;
    const clip = track.items.find((it) => it.id === itemId);
    if (clip && clip.kind === 'clip') {
      clips.push(clip as TimelineClipItem);
    }
  }
  return clips;
});

const hasGroupedClip = computed(() =>
  selectedClips.value.some((clip) => typeof clip.linkedGroupId === 'string' && clip.linkedGroupId.trim().length > 0),
);

function handleUnlinkSelected() {
  const doc = timelineStore.timelineDoc;
  if (!doc) return;

  const selectedIds = new Set(props.items.map((x) => x.itemId));
  const videoIds: string[] = [];

  for (const track of doc.tracks) {
    for (const it of track.items) {
      if (!selectedIds.has(it.id)) continue;
      if (it.kind !== 'clip') continue;
      if (track.kind === 'video') videoIds.push(it.id);
    }
  }

  const cmds: Array<{
    type: 'update_clip_properties';
    trackId: string;
    itemId: string;
    properties: { linkedVideoClipId: undefined; lockToLinkedVideo: false };
  }> = [];

  for (const track of doc.tracks) {
    if (track.kind !== 'audio') continue;
    for (const it of track.items) {
      if (it.kind !== 'clip') continue;
      const linked = String((it as any).linkedVideoClipId ?? '');
      const isLocked = Boolean((it as any).lockToLinkedVideo);

      const shouldUnlink =
        (selectedIds.has(it.id) && Boolean((it as any).linkedVideoClipId) && isLocked) ||
        (videoIds.length > 0 && isLocked && linked && videoIds.includes(linked));

      if (!shouldUnlink) continue;

      cmds.push({
        type: 'update_clip_properties',
        trackId: track.id,
        itemId: it.id,
        properties: { linkedVideoClipId: undefined, lockToLinkedVideo: false },
      });
    }
  }

  if (cmds.length === 0) return;
  timelineStore.batchApplyTimeline(cmds as any);
}

function handleGroupSelected() {
  if (props.items.length < 2) return;

  const nextGroupId = generatedGroupId();
  const cmds = props.items.map(({ trackId, itemId }) => ({
    type: 'update_clip_properties' as const,
    trackId,
    itemId,
    properties: {
      linkedGroupId: nextGroupId,
    },
  }));

  timelineStore.batchApplyTimeline(cmds as any);
}

function handleUngroupSelected() {
  const cmds = props.items.map(({ trackId, itemId }) => ({
    type: 'update_clip_properties' as const,
    trackId,
    itemId,
    properties: {
      linkedGroupId: undefined,
    },
  }));

  timelineStore.batchApplyTimeline(cmds as any);
}

const hasFreeClip = computed(() => {
  const doc = timelineStore.timelineDoc;
  if (!doc) return false;
  const fps = sanitizeFps(doc.timebase?.fps);
  return selectedClips.value.some((clip) => {
    const startFrame = (clip.timelineRange.startUs * fps) / 1_000_000;
    const durFrame = (clip.timelineRange.durationUs * fps) / 1_000_000;
    const isStartQuantized = Math.abs(startFrame - Math.round(startFrame)) < 0.001;
    const isDurationQuantized = Math.abs(durFrame - Math.round(durFrame)) < 0.001;
    return !isStartQuantized || !isDurationQuantized;
  });
});

const allDisabled = computed(() => selectedClips.value.every((c) => c.disabled));
const allMuted = computed(() => selectedClips.value.every((c) => c.audioMuted));
const allShowWaveform = computed(() => selectedClips.value.every((c) => c.showWaveform !== false));
const allWaveformHalf = computed(() => selectedClips.value.every((c) => c.audioWaveformMode !== 'full'));

const hasAudioOrVideoWithAudio = computed(() => {
  const doc = timelineStore.timelineDoc;
  if (!doc) return false;
  return props.items.some(({ trackId, itemId }) => {
    const track = doc.tracks.find((t) => t.id === trackId);
    if (!track) return false;
    const clip = track.items.find((it) => it.id === itemId);
    if (!clip || clip.kind !== 'clip') return false;
    
    if (track.kind === 'audio') return true;
    if (track.kind === 'video' && clip.clipType === 'media' && Boolean((clip as any).linkedVideoClipId))
      return true;
    if (track.kind === 'video' && clip.clipType === 'media' && Boolean((clip as any).source?.hasAudio))
      return true;
    return false;
  });
});

const hasVideo = computed(() => {
  const doc = timelineStore.timelineDoc;
  if (!doc) return false;
  return props.items.some(({ trackId }) => {
    const track = doc.tracks.find((t) => t.id === trackId);
    return track?.kind === 'video';
  });
});

function handleDelete() {
  const cmds = props.items.map(({ trackId, itemId }) => ({
    type: 'delete_items' as const,
    trackId,
    itemIds: [itemId],
  }));
  timelineStore.batchApplyTimeline(cmds);
  timelineStore.clearSelection();
}

function toggleDisabled() {
  const nextVal = !allDisabled.value;
  const cmds = props.items.map(({ trackId, itemId }) => ({
    type: 'update_clip_properties' as const,
    trackId,
    itemId,
    properties: { disabled: nextVal },
  }));
  timelineStore.batchApplyTimeline(cmds);
}

function toggleMuted() {
  const nextVal = !allMuted.value;
  const cmds = props.items.map(({ trackId, itemId }) => ({
    type: 'update_clip_properties' as const,
    trackId,
    itemId,
    properties: { audioMuted: nextVal },
  }));
  timelineStore.batchApplyTimeline(cmds);
}

function toggleShowWaveform() {
  const nextVal = !allShowWaveform.value;
  const cmds = props.items.map(({ trackId, itemId }) => ({
    type: 'update_clip_properties' as const,
    trackId,
    itemId,
    properties: { showWaveform: nextVal },
  }));
  timelineStore.batchApplyTimeline(cmds);
}

function toggleWaveformMode() {
  const nextVal: 'full' | 'half' = allWaveformHalf.value ? 'full' : 'half';
  const cmds = props.items.map(({ trackId, itemId }) => ({
    type: 'update_clip_properties' as const,
    trackId,
    itemId,
    properties: { audioWaveformMode: nextVal },
  }));
  timelineStore.batchApplyTimeline(cmds);
}

function handleSetUniformDuration(durationUs: number) {
  const doc = timelineStore.timelineDoc;
  if (!doc) return;

  const nextDurationUs = Math.max(1, Math.round(Number(durationUs)));
  if (!Number.isFinite(nextDurationUs)) return;

  const cmds: Array<{
    type: 'trim_item';
    trackId: string;
    itemId: string;
    edge: 'end';
    deltaUs: number;
  }> = [];

  for (const { trackId, itemId } of props.items) {
    const track = doc.tracks.find((t) => t.id === trackId);
    if (!track) continue;
    const clip = track.items.find((it) => it.id === itemId);
    if (!clip || clip.kind !== 'clip') continue;
    if (Boolean((clip as any).locked)) continue;

    const currentDurationUs = Math.max(0, Math.round(Number(clip.timelineRange.durationUs)));
    const deltaUs = nextDurationUs - currentDurationUs;
    if (deltaUs === 0) continue;

    cmds.push({
      type: 'trim_item',
      trackId,
      itemId,
      edge: 'end',
      deltaUs,
    });
  }

  if (cmds.length === 0) return;
  timelineStore.batchApplyTimeline(cmds);
}

function handleQuantizeSelected() {
  const doc = timelineStore.timelineDoc;
  if (!doc) return;
  const fps = sanitizeFps(doc.timebase?.fps);

  const cmds: Array<{
    type: 'trim_item';
    trackId: string;
    itemId: string;
    edge: 'end';
    deltaUs: number;
    quantizeToFrames: true;
  }> = [];

  for (const { trackId, itemId } of props.items) {
    const track = doc.tracks.find((t) => t.id === trackId);
    if (!track) continue;
    const clip = track.items.find((it) => it.id === itemId);
    if (!clip || clip.kind !== 'clip') continue;
    if (Boolean((clip as any).locked)) continue;

    const startFrame = (clip.timelineRange.startUs * fps) / 1_000_000;
    const durFrame = (clip.timelineRange.durationUs * fps) / 1_000_000;
    const isStartQuantized = Math.abs(startFrame - Math.round(startFrame)) < 0.001;
    const isDurationQuantized = Math.abs(durFrame - Math.round(durFrame)) < 0.001;
    const isFree = !isStartQuantized || !isDurationQuantized;
    if (!isFree) continue;

    cmds.push({
      type: 'trim_item',
      trackId,
      itemId,
      edge: 'end',
      deltaUs: 0,
      quantizeToFrames: true,
    });
  }

  if (cmds.length === 0) return;
  timelineStore.batchApplyTimeline(cmds);
}
</script>

<template>
  <div class="flex flex-col gap-4 w-full">
    <PropertySection :title="t('granVideoEditor.timeline.multipleSelection', 'Multiple Selection')">
      <div class="px-3 pb-3 flex flex-col gap-2">
        <span class="text-sm text-ui-text-muted">
          {{ selectedCountLabel }}
        </span>

        <div class="flex flex-col gap-0.5 mt-2">
          <span class="text-xs text-ui-text-muted">{{ t('common.duration', 'Duration') }}</span>
          <TimecodeInput
            :model-value="selectedClips[0]?.timelineRange.durationUs ?? 0"
            @update:model-value="handleSetUniformDuration"
          />
        </div>
      </div>
    </PropertySection>

    <PropertySection :title="t('common.actions', 'Actions')">
      <div class="px-3 pb-3 flex flex-col gap-2">
        <UButton
          size="sm"
          color="danger"
          variant="soft"
          icon="i-heroicons-trash"
          :label="t('common.delete', 'Delete')"
          @click="handleDelete"
        />

        <UButton
          size="sm"
          color="neutral"
          variant="soft"
          :icon="allDisabled ? 'i-heroicons-eye' : 'i-heroicons-eye-slash'"
          :label="allDisabled ? t('granVideoEditor.timeline.enableClips', 'Enable clips') : t('granVideoEditor.timeline.disableClips', 'Disable clips')"
          @click="toggleDisabled"
        />

        <UButton
          v-if="items.length > 1"
          size="sm"
          color="neutral"
          variant="soft"
          icon="i-heroicons-link"
          :label="t('granVideoEditor.timeline.groupClips', 'Group clips')"
          @click="handleGroupSelected"
        />

        <UButton
          v-if="hasGroupedClip"
          size="sm"
          color="neutral"
          variant="soft"
          icon="i-heroicons-link-slash"
          :label="t('granVideoEditor.timeline.ungroupClips', 'Ungroup clips')"
          @click="handleUngroupSelected"
        />

        <UButton
          v-if="hasFreeClip"
          size="sm"
          color="neutral"
          variant="soft"
          icon="i-heroicons-squares-2x2"
          :label="t('granVideoEditor.timeline.quantize', 'Quantize to frames')"
          @click="handleQuantizeSelected"
        />

        <UButton
          v-if="hasLockedLinks"
          size="sm"
          color="neutral"
          variant="soft"
          icon="i-heroicons-link-slash"
          :label="t('granVideoEditor.timeline.unlinkAudio', 'Unlink audio')"
          @click="handleUnlinkSelected"
        />

        <template v-if="hasAudioOrVideoWithAudio">
          <UButton
            size="sm"
            color="neutral"
            variant="soft"
            :icon="allMuted ? 'i-heroicons-speaker-wave' : 'i-heroicons-speaker-x-mark'"
            :label="allMuted ? t('granVideoEditor.timeline.unmuteClips', 'Unmute clips') : t('granVideoEditor.timeline.muteClips', 'Mute clips')"
            @click="toggleMuted"
          />
          
          <UButton
            size="sm"
            color="neutral"
            variant="soft"
            icon="i-heroicons-chart-bar"
            :label="allWaveformHalf ? t('granVideoEditor.timeline.waveformFull', 'Waveform: Full') : t('granVideoEditor.timeline.waveformHalf', 'Waveform: Half')"
            @click="toggleWaveformMode"
          />
        </template>
        
        <template v-if="hasVideo">
          <UButton
            size="sm"
            color="neutral"
            variant="soft"
            :icon="allShowWaveform ? 'i-heroicons-eye-slash' : 'i-heroicons-eye'"
            :label="allShowWaveform ? t('granVideoEditor.timeline.hideWaveform', 'Hide Waveform') : t('granVideoEditor.timeline.showWaveform', 'Show Waveform')"
            @click="toggleShowWaveform"
          />
        </template>
      </div>
    </PropertySection>
  </div>
</template>
