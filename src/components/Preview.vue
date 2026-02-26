<script setup lang="ts">
import { ref, watch, onUnmounted, computed } from 'vue';
import { useUiStore } from '~/stores/ui.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useMediaStore } from '~/stores/media.store';
import { useProxyStore } from '~/stores/proxy.store';
import type { TimelineClipItem } from '~/timeline/types';
import yaml from 'js-yaml';
import RenameModal from '~/components/common/RenameModal.vue';
import EffectsEditor from '~/components/common/EffectsEditor.vue';
import type { TimelineTrack } from '~/timeline/types';
import ClipTransitionPanel from '~/components/timeline/ClipTransitionPanel.vue';

defineOptions({
  name: 'PreviewPanel',
});

const { t } = useI18n();
const uiStore = useUiStore();
const timelineStore = useTimelineStore();
const mediaStore = useMediaStore();
const proxyStore = useProxyStore();

const currentUrl = ref<string | null>(null);
const mediaType = ref<'image' | 'video' | 'audio' | 'text' | 'unknown' | null>(null);
const textContent = ref<string>('');
const previewMode = ref<'original' | 'proxy'>('original');

const fileInfo = ref<{
  name: string;
  kind: string;
  size?: number;
  lastModified?: number;
  metadata?: unknown;
} | null>(null);

const selectedClip = computed<TimelineClipItem | null>(() => {
  if (timelineStore.selectedItemIds.length !== 1) return null;
  const id = timelineStore.selectedItemIds[0];
  for (const track of timelineStore.timelineDoc?.tracks ?? []) {
    const item = track.items.find((it) => it.id === id);
    if (item && item.kind === 'clip') {
      return item as TimelineClipItem;
    }
  }
  return null;
});

const selectedTransition = computed(() => timelineStore.selectedTransition);

const selectedTransitionClip = computed<TimelineClipItem | null>(() => {
  const sel = selectedTransition.value;
  if (!sel) return null;
  const track = timelineStore.timelineDoc?.tracks.find((t) => t.id === sel.trackId);
  const item = track?.items.find((it) => it.id === sel.itemId);
  return item && item.kind === 'clip' ? (item as TimelineClipItem) : null;
});

const selectedTransitionValue = computed<import('~/timeline/types').ClipTransition | undefined>(() => {
  const sel = selectedTransition.value;
  const clip = selectedTransitionClip.value as any;
  if (!sel || !clip) return undefined;
  return sel.edge === 'in' ? clip.transitionIn : clip.transitionOut;
});

const selectedTrack = computed<TimelineTrack | null>(() => {
  const trackId = timelineStore.selectedTrackId;
  if (!trackId) return null;
  const tracks = (timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined) ?? [];
  return tracks.find((t) => t.id === trackId) ?? null;
});

const isRenameModalOpen = ref(false);

function handleUpdateOpacity(val: number | undefined) {
  if (!selectedClip.value) return;
  const safe = typeof val === 'number' && Number.isFinite(val) ? val : 1;
  timelineStore.updateClipProperties(selectedClip.value.trackId, selectedClip.value.id, {
    opacity: safe,
  });
}

function handleUpdateClipEffects(effects: any[]) {
  if (!selectedClip.value) return;
  timelineStore.updateClipProperties(selectedClip.value.trackId, selectedClip.value.id, {
    effects: effects as any,
  });
}

function handleUpdateAudioGain(val: unknown) {
  if (!selectedClip.value) return;
  const v = typeof val === 'number' && Number.isFinite(val) ? val : Number(val);
  const safe = Number.isFinite(v) ? Math.max(0, Math.min(2, v)) : 1;
  timelineStore.updateClipProperties(selectedClip.value.trackId, selectedClip.value.id, {
    audioGain: safe,
  });
}

function handleUpdateBackgroundColor(val: string | undefined) {
  if (!selectedClip.value) return;
  if (selectedClip.value.clipType !== 'background') return;
  const safe = typeof val === 'string' && val.trim().length > 0 ? val.trim() : '#000000';
  timelineStore.updateClipProperties(selectedClip.value.trackId, selectedClip.value.id, {
    backgroundColor: safe,
  });
}

function handleUpdateText(val: string | undefined) {
  if (!selectedClip.value) return;
  if (selectedClip.value.clipType !== 'text') return;
  timelineStore.updateClipProperties(selectedClip.value.trackId, selectedClip.value.id, {
    text: typeof val === 'string' ? val : '',
  });
}

function handleUpdateTextStyle(patch: Partial<import('~/timeline/types').TextClipStyle>) {
  if (!selectedClip.value) return;
  if (selectedClip.value.clipType !== 'text') return;
  const curr = ((selectedClip.value as any).style ?? {}) as import('~/timeline/types').TextClipStyle;
  timelineStore.updateClipProperties(selectedClip.value.trackId, selectedClip.value.id, {
    style: {
      ...curr,
      ...patch,
    },
  });
}

function handleUpdateTrackEffects(effects: any[]) {
  if (!selectedTrack.value) return;
  timelineStore.updateTrackProperties(selectedTrack.value.id, { effects: effects as any });
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
  const posX = typeof positionRaw.x === 'number' && Number.isFinite(positionRaw.x) ? positionRaw.x : 0;
  const posY = typeof positionRaw.y === 'number' && Number.isFinite(positionRaw.y) ? positionRaw.y : 0;

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
  const anchorX = typeof anchorRaw.x === 'number' && Number.isFinite(anchorRaw.x) ? anchorRaw.x : 0.5;
  const anchorY = typeof anchorRaw.y === 'number' && Number.isFinite(anchorRaw.y) ? anchorRaw.y : 0.5;

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
  if (!selectedClip.value) return;
  const clip = selectedClip.value;
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
  const clip = selectedClip.value;
  if (!clip) return false;
  return clip.trackId.startsWith('v');
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
    if (!selectedClip.value) return true;
    return Boolean(getSafeTransform(selectedClip.value).scale?.linked);
  },
  set: (val: boolean) => {
    if (!selectedClip.value) return;
    const current = getSafeTransform(selectedClip.value);
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
    if (!selectedClip.value) return 1;
    return getSafeTransform(selectedClip.value).scale?.x ?? 1;
  },
  set: (val: number) => {
    if (!selectedClip.value) return;
    const current = getSafeTransform(selectedClip.value);
    const linked = Boolean(current.scale?.linked);
    const x = clampNumber(val, 0.001, 1000);
    const y = linked ? x : current.scale?.y ?? 1;
    updateSelectedClipTransform({ scale: { x, y, linked } });
  },
});

const transformScaleY = computed({
  get: () => {
    if (!selectedClip.value) return 1;
    return getSafeTransform(selectedClip.value).scale?.y ?? 1;
  },
  set: (val: number) => {
    if (!selectedClip.value) return;
    const current = getSafeTransform(selectedClip.value);
    const linked = Boolean(current.scale?.linked);
    const y = clampNumber(val, 0.001, 1000);
    const x = linked ? y : current.scale?.x ?? 1;
    updateSelectedClipTransform({ scale: { x, y, linked } });
  },
});

const transformRotationDeg = computed({
  get: () => {
    if (!selectedClip.value) return 0;
    return getSafeTransform(selectedClip.value).rotationDeg ?? 0;
  },
  set: (val: number) => {
    if (!selectedClip.value) return;
    updateSelectedClipTransform({ rotationDeg: clampNumber(val, -36000, 36000) });
  },
});

const transformPosX = computed({
  get: () => {
    if (!selectedClip.value) return 0;
    return getSafeTransform(selectedClip.value).position?.x ?? 0;
  },
  set: (val: number) => {
    if (!selectedClip.value) return;
    const current = getSafeTransform(selectedClip.value);
    updateSelectedClipTransform({
      position: { x: clampNumber(val, -1_000_000, 1_000_000), y: current.position?.y ?? 0 },
    });
  },
});

const transformPosY = computed({
  get: () => {
    if (!selectedClip.value) return 0;
    return getSafeTransform(selectedClip.value).position?.y ?? 0;
  },
  set: (val: number) => {
    if (!selectedClip.value) return;
    const current = getSafeTransform(selectedClip.value);
    updateSelectedClipTransform({
      position: { x: current.position?.x ?? 0, y: clampNumber(val, -1_000_000, 1_000_000) },
    });
  },
});

const transformAnchorPreset = computed({
  get: () => {
    if (!selectedClip.value) return 'center';
    return getSafeTransform(selectedClip.value).anchor?.preset ?? 'center';
  },
  set: (val: string) => {
    if (!selectedClip.value) return;
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
    if (!selectedClip.value) return 0.5;
    return getSafeTransform(selectedClip.value).anchor?.x ?? 0.5;
  },
  set: (val: number) => {
    if (!selectedClip.value) return;
    const current = getSafeTransform(selectedClip.value);
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
    if (!selectedClip.value) return 0.5;
    return getSafeTransform(selectedClip.value).anchor?.y ?? 0.5;
  },
  set: (val: number) => {
    if (!selectedClip.value) return;
    const current = getSafeTransform(selectedClip.value);
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

const displayMode = computed<'transition' | 'clip' | 'track' | 'file' | 'empty'>(() => {
  if (selectedTransitionClip.value && selectedTransitionValue.value) return 'transition';
  if (selectedClip.value) return 'clip';
  if (selectedTrack.value) return 'track';
  if (uiStore.selectedFsEntry && uiStore.selectedFsEntry.kind === 'file') return 'file';
  return 'empty';
});

const hasProxy = computed(() => {
  if (displayMode.value !== 'file' || !uiStore.selectedFsEntry || !uiStore.selectedFsEntry.path)
    return false;
  return proxyStore.existingProxies.has(uiStore.selectedFsEntry.path);
});

const selectedClipTrack = computed<TimelineTrack | null>(() => {
  const clip = selectedClip.value;
  if (!clip) return null;
  return (timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined)?.find((t) => t.id === clip.trackId) ?? null;
});

const canEditAudioFades = computed(() => {
  const clip = selectedClip.value;
  if (!clip) return false;
  if (clip.clipType !== 'media' && clip.clipType !== 'timeline') return false;
  return true;
});

const canEditAudioGain = computed(() => {
  const clip = selectedClip.value;
  if (!clip) return false;
  if (clip.clipType !== 'media' && clip.clipType !== 'timeline') return false;
  return true;
});

const audioGain = computed({
  get: () => {
    const clip = selectedClip.value as any;
    const v = typeof clip?.audioGain === 'number' && Number.isFinite(clip.audioGain) ? clip.audioGain : 1;
    return Math.max(0, Math.min(2, v));
  },
  set: (val: number) => {
    if (!selectedClip.value) return;
    const current = selectedClip.value as any;
    const v = Math.max(0, Math.min(2, Number(val)));
    timelineStore.updateClipProperties(current.trackId, current.id, { audioGain: v });
  },
});

const clipDurationSec = computed(() => {
  const clip = selectedClip.value;
  if (!clip) return 0;
  return Math.max(0, Number(clip.timelineRange?.durationUs ?? 0) / 1_000_000);
});

const audioFadeInSec = computed({
  get: () => {
    const clip = selectedClip.value as any;
    const v = typeof clip?.audioFadeInUs === 'number' && Number.isFinite(clip.audioFadeInUs) ? clip.audioFadeInUs : 0;
    return Math.max(0, v / 1_000_000);
  },
  set: (val: number) => {
    if (!selectedClip.value) return;
    const current = selectedClip.value as any;
    const v = Math.max(0, Math.min(val, clipDurationSec.value)) * 1_000_000;
    timelineStore.updateClipProperties(current.trackId, current.id, { audioFadeInUs: v });
  },
});

const audioFadeOutSec = computed({
  get: () => {
    const clip = selectedClip.value as any;
    const v = typeof clip?.audioFadeOutUs === 'number' && Number.isFinite(clip.audioFadeOutUs) ? clip.audioFadeOutUs : 0;
    return Math.max(0, v / 1_000_000);
  },
  set: (val: number) => {
    if (!selectedClip.value) return;
    const current = selectedClip.value as any;
    const v = Math.max(0, Math.min(val, clipDurationSec.value)) * 1_000_000;
    timelineStore.updateClipProperties(current.trackId, current.id, { audioFadeOutUs: v });
  },
});

const audioFadeMaxSec = computed(() => Math.max(0, Math.min(10, clipDurationSec.value)));

watch(hasProxy, (val) => {
  if (!val && previewMode.value === 'proxy') {
    previewMode.value = 'original';
  }
});

async function loadPreviewMedia() {
  if (currentUrl.value) {
    URL.revokeObjectURL(currentUrl.value);
    currentUrl.value = null;
  }

  const entry = uiStore.selectedFsEntry;
  if (!entry || entry.kind !== 'file') return;

  try {
    let fileToPlay: File;

    if (previewMode.value === 'proxy' && hasProxy.value && entry.path) {
      const proxyFile = await proxyStore.getProxyFile(entry.path);
      if (proxyFile) {
        fileToPlay = proxyFile;
      } else {
        fileToPlay = await (entry.handle as FileSystemFileHandle).getFile();
      }
    } else {
      fileToPlay = await (entry.handle as FileSystemFileHandle).getFile();
    }

    if (mediaType.value === 'image' || mediaType.value === 'video' || mediaType.value === 'audio') {
      currentUrl.value = URL.createObjectURL(fileToPlay);
    }
  } catch (e) {
    console.error('Failed to load preview media:', e);
  }
}

watch(previewMode, () => {
  void loadPreviewMedia();
});

watch(
  () => uiStore.selectedFsEntry,
  async (entry) => {
    // Revoke old URL
    if (currentUrl.value) {
      URL.revokeObjectURL(currentUrl.value);
      currentUrl.value = null;
    }
    mediaType.value = null;
    textContent.value = '';
    fileInfo.value = null;
    previewMode.value = 'original';

    if (!entry || entry.kind !== 'file') return;

    try {
      const file = await (entry.handle as FileSystemFileHandle).getFile();

      fileInfo.value = {
        name: file.name,
        kind: 'file',
        size: file.size,
        lastModified: file.lastModified,
        metadata: entry.path
          ? await mediaStore.getOrFetchMetadata(entry.handle as FileSystemFileHandle, entry.path, {
              forceRefresh: true,
            })
          : undefined,
      };

      const ext = entry.name.split('.').pop()?.toLowerCase();
      const textExtensions = ['txt', 'md', 'json', 'yaml', 'yml'];

      if (file.type.startsWith('image/')) {
        mediaType.value = 'image';
      } else if (file.type.startsWith('video/')) {
        mediaType.value = 'video';
      } else if (file.type.startsWith('audio/')) {
        mediaType.value = 'audio';
      } else if (textExtensions.includes(ext || '') || file.type.startsWith('text/')) {
        mediaType.value = 'text';
        // limit text read to first 1MB
        const textSlice = file.slice(0, 1024 * 1024);
        textContent.value = await textSlice.text();
        if (file.size > 1024 * 1024) {
          textContent.value += '\n... (truncated)';
        }
      } else {
        mediaType.value = 'unknown';
      }

      if (
        mediaType.value === 'image' ||
        mediaType.value === 'video' ||
        mediaType.value === 'audio'
      ) {
        await loadPreviewMedia();
      }
    } catch (e) {
      console.error('Failed to preview file:', e);
    }
  },
);

onUnmounted(() => {
  if (currentUrl.value) {
    URL.revokeObjectURL(currentUrl.value);
  }
});

function formatMegabytes(bytes: number, decimals = 2): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(decimals)} MB`;
}

function formatTime(us: number): string {
  if (!us) return '0.00s';
  return (us / 1_000_000).toFixed(2) + 's';
}

const metadataYaml = computed(() => {
  if (!fileInfo.value?.metadata) return null;
  try {
    return yaml.dump(fileInfo.value.metadata, { indent: 2 });
  } catch {
    return String(fileInfo.value.metadata);
  }
});

function handleDeleteClip() {
  if (selectedClip.value) {
    timelineStore.deleteSelectedItems(selectedClip.value.trackId);
  }
}

function handleRenameClip(newName: string) {
  if (selectedClip.value && newName.trim()) {
    timelineStore.renameItem(selectedClip.value.trackId, selectedClip.value.id, newName.trim());
  }
}

const isUnknown = computed(() => mediaType.value === 'unknown');

function handleTransitionUpdate(payload: {
  trackId: string;
  itemId: string;
  edge: 'in' | 'out';
  transition: import('~/timeline/types').ClipTransition | null;
}) {
  if (payload.edge === 'in') {
    timelineStore.updateClipTransition(payload.trackId, payload.itemId, { transitionIn: payload.transition });
  } else {
    timelineStore.updateClipTransition(payload.trackId, payload.itemId, { transitionOut: payload.transition });
  }
}
</script>

<template>
  <div class="flex flex-col h-full bg-ui-bg-elevated border-r border-ui-border min-w-0">
    <!-- Header -->
    <div
      class="flex items-center justify-between px-3 py-2 border-b border-ui-border shrink-0 h-10"
    >
      <div class="flex items-center overflow-hidden min-w-0">
        <span class="text-xs font-semibold text-ui-text-muted uppercase tracking-wider shrink-0">
          {{ t('granVideoEditor.preview.title', 'Properties') }}
        </span>
        <span v-if="displayMode === 'clip'" class="ml-2 text-xs text-gray-500 font-mono truncate">
          {{ selectedClip?.name }}
        </span>
        <span
          v-else-if="displayMode === 'transition'"
          class="ml-2 text-xs text-gray-500 font-mono truncate"
        >
          {{ selectedTransitionClip?.name }}
        </span>
        <span
          v-else-if="displayMode === 'file' && uiStore.selectedFsEntry"
          class="ml-2 text-xs text-gray-500 font-mono truncate"
        >
          {{ uiStore.selectedFsEntry.name }}
        </span>
      </div>
      <div v-if="displayMode === 'clip'" class="flex gap-1 shrink-0 ml-2">
        <UButton
          size="xs"
          variant="ghost"
          color="neutral"
          icon="i-heroicons-pencil"
          @click="isRenameModalOpen = true"
        />
        <UButton
          size="xs"
          variant="ghost"
          color="red"
          icon="i-heroicons-trash"
          @click="handleDeleteClip"
        />
      </div>
      <div v-else-if="displayMode === 'transition'" class="flex gap-1 shrink-0 ml-2">
        <UButton
          size="xs"
          variant="ghost"
          color="neutral"
          icon="i-heroicons-x-mark"
          @click="timelineStore.clearSelectedTransition()"
        />
      </div>
      <div v-else-if="displayMode === 'file' && hasProxy" class="flex gap-1 shrink-0 ml-2">
        <UFieldGroup size="xs">
          <UButton
            :color="previewMode === 'original' ? 'primary' : 'neutral'"
            :variant="previewMode === 'original' ? 'soft' : 'ghost'"
            :label="t('videoEditor.fileManager.preview.original', 'Original')"
            @click="previewMode = 'original'"
          />
          <UButton
            :color="previewMode === 'proxy' ? 'primary' : 'neutral'"
            :variant="previewMode === 'proxy' ? 'soft' : 'ghost'"
            :label="t('videoEditor.fileManager.preview.proxy', 'Proxy')"
            @click="previewMode = 'proxy'"
          />
        </UFieldGroup>
      </div>
    </div>

    <!-- Content Area -->
    <div class="flex-1 min-h-0 bg-black relative">
      <div class="absolute inset-0 overflow-auto">
        <div class="flex flex-col min-w-62.5 p-4 items-start w-full">
          <div
            v-if="displayMode === 'empty'"
            class="w-full flex flex-col items-center justify-center gap-3 text-gray-700 min-h-50"
          >
            <UIcon name="i-heroicons-eye" class="w-16 h-16" />
            <p class="text-sm">
              {{ t('granVideoEditor.preview.noSelection', 'No item selected') }}
            </p>
          </div>

          <!-- Transition Properties -->
          <div
            v-else-if="displayMode === 'transition' && selectedTransition && selectedTransitionClip"
            class="w-full flex flex-col gap-4 text-white"
          >
            <div class="flex items-center gap-3">
              <UIcon name="i-heroicons-arrows-right-left" class="w-10 h-10 shrink-0 text-amber-300" />
              <div class="min-w-0">
                <h3 class="font-medium text-lg truncate">
                  {{ selectedTransition.edge === 'in' ? 'Transition In' : 'Transition Out' }}
                </h3>
                <span class="text-xs text-gray-400 uppercase truncate">{{ selectedTransitionClip.name }}</span>
              </div>
            </div>

            <div class="mt-2">
              <ClipTransitionPanel
                :edge="selectedTransition.edge"
                :track-id="selectedTransition.trackId"
                :item-id="selectedTransition.itemId"
                :transition="selectedTransitionValue"
                @update="handleTransitionUpdate"
              />
            </div>
          </div>

          <!-- Clip Properties -->
          <div
            v-else-if="displayMode === 'clip' && selectedClip"
            class="w-full flex flex-col gap-4 text-white"
          >
            <div class="flex items-center gap-3">
              <UIcon
                :name="
                  selectedClip.trackId.startsWith('v')
                    ? 'i-heroicons-video-camera'
                    : 'i-heroicons-musical-note'
                "
                class="w-10 h-10 shrink-0"
                :class="selectedClip.trackId.startsWith('v') ? 'text-indigo-400' : 'text-teal-400'"
              />
              <div class="min-w-0">
                <h3 class="font-medium text-lg truncate">{{ selectedClip.name }}</h3>
                <span class="text-xs text-gray-400 uppercase">
                  {{
                    selectedClip.trackId.startsWith('v')
                      ? t('common.video', 'Video Clip')
                      : t('common.audio', 'Audio Clip')
                  }}
                </span>
              </div>
            </div>

            <div class="space-y-2 mt-4 bg-gray-900 p-4 rounded border border-gray-800 text-sm">
              <div
                v-if="selectedClip.clipType === 'media'"
                class="flex flex-col gap-1 border-b border-gray-800 pb-2"
              >
                <span class="text-gray-500">{{ t('common.source', 'Source File') }}</span>
                <span class="font-medium break-all">{{ selectedClip.source.path }}</span>
              </div>
              <div
                v-else-if="selectedClip.clipType === 'background'"
                class="flex flex-col gap-1 border-b border-gray-800 pb-2"
              >
                <span class="text-gray-500">{{ t('common.color', 'Color') }}</span>
                <div class="flex items-center justify-between gap-3">
                  <span class="font-mono text-xs text-gray-300">{{ selectedClip.backgroundColor }}</span>
                  <UColorPicker
                    :model-value="selectedClip.backgroundColor"
                    format="hex"
                    size="sm"
                    @update:model-value="handleUpdateBackgroundColor"
                  />
                </div>
              </div>
              <div
                v-else-if="selectedClip.clipType === 'text'"
                class="flex flex-col gap-3 border-b border-gray-800 pb-2"
              >
                <span class="text-gray-500">{{ t('granVideoEditor.textClip.text', 'Text') }}</span>
                <UTextarea
                  :model-value="(selectedClip as any).text"
                  size="sm"
                  :rows="4"
                  @update:model-value="handleUpdateText"
                />

                <div class="grid grid-cols-2 gap-3">
                  <div class="flex flex-col gap-1">
                    <span class="text-gray-500">{{ t('granVideoEditor.textClip.fontSize', 'Font size') }}</span>
                    <UInput
                      :model-value="Number(((selectedClip as any).style?.fontSize ?? 64))"
                      size="sm"
                      type="number"
                      step="1"
                      @update:model-value="(v: any) => handleUpdateTextStyle({ fontSize: Number(v) })"
                    />
                  </div>
                  <div class="flex flex-col gap-1">
                    <span class="text-gray-500">{{ t('common.color', 'Color') }}</span>
                    <UColorPicker
                      :model-value="String(((selectedClip as any).style?.color ?? '#ffffff'))"
                      format="hex"
                      size="sm"
                      @update:model-value="(v: any) => handleUpdateTextStyle({ color: String(v) })"
                    />
                  </div>
                </div>

                <div class="flex flex-col gap-1">
                  <span class="text-gray-500">{{ t('granVideoEditor.textClip.align', 'Align') }}</span>
                  <USelect
                    :model-value="String(((selectedClip as any).style?.align ?? 'center'))"
                    :options="[
                      { value: 'left', label: 'Left' },
                      { value: 'center', label: 'Center' },
                      { value: 'right', label: 'Right' },
                    ]"
                    size="sm"
                    @update:model-value="(v: any) => handleUpdateTextStyle({ align: v })"
                  />
                </div>

                <div class="flex flex-col gap-1">
                  <span class="text-gray-500">{{ t('granVideoEditor.textClip.verticalAlign', 'Vertical align') }}</span>
                  <USelect
                    :model-value="String(((selectedClip as any).style?.verticalAlign ?? 'middle'))"
                    :options="[
                      { value: 'top', label: 'Top' },
                      { value: 'middle', label: 'Middle' },
                      { value: 'bottom', label: 'Bottom' },
                    ]"
                    size="sm"
                    @update:model-value="(v: any) => handleUpdateTextStyle({ verticalAlign: v })"
                  />
                </div>

                <div class="grid grid-cols-2 gap-3">
                  <div class="flex flex-col gap-1">
                    <span class="text-gray-500">{{ t('granVideoEditor.textClip.lineHeight', 'Line height') }}</span>
                    <UInput
                      :model-value="Number(((selectedClip as any).style?.lineHeight ?? 1.2))"
                      size="sm"
                      type="number"
                      step="0.1"
                      @update:model-value="(v: any) => handleUpdateTextStyle({ lineHeight: Number(v) })"
                    />
                  </div>
                  <div class="flex flex-col gap-1">
                    <span class="text-gray-500">{{ t('granVideoEditor.textClip.letterSpacing', 'Letter spacing') }}</span>
                    <UInput
                      :model-value="Number(((selectedClip as any).style?.letterSpacing ?? 0))"
                      size="sm"
                      type="number"
                      step="1"
                      @update:model-value="(v: any) => handleUpdateTextStyle({ letterSpacing: Number(v) })"
                    />
                  </div>
                </div>

                <div class="flex flex-col gap-1">
                  <span class="text-gray-500">{{ t('granVideoEditor.textClip.backgroundColor', 'Background') }}</span>
                  <UColorPicker
                    :model-value="String(((selectedClip as any).style?.backgroundColor ?? ''))"
                    format="hex"
                    size="sm"
                    @update:model-value="(v: any) => handleUpdateTextStyle({ backgroundColor: String(v) })"
                  />
                </div>

                <div class="flex flex-col gap-1">
                  <span class="text-gray-500">{{ t('granVideoEditor.textClip.padding', 'Padding') }}</span>
                  <UInput
                    :model-value="Number(((selectedClip as any).style?.padding ?? 60))"
                    size="sm"
                    type="number"
                    step="1"
                    @update:model-value="(v: any) => handleUpdateTextStyle({ padding: Number(v) })"
                  />
                </div>
              </div>
              <div class="flex flex-col gap-1 border-b border-gray-800 pb-2">
                <span class="text-gray-500">{{ t('common.start', 'Start Time') }}</span>
                <span class="font-mono">{{ formatTime(selectedClip.timelineRange.startUs) }}</span>
              </div>
              <div class="flex flex-col gap-1 pb-2">
                <span class="text-gray-500">{{ t('common.duration', 'Duration') }}</span>
                <span class="font-mono">{{
                  formatTime(selectedClip.timelineRange.durationUs)
                }}</span>
              </div>
            </div>

            <!-- Transparency (Opacity) -->
            <div
              v-if="selectedClip.clipType !== 'adjustment'"
              class="space-y-3 mt-2 bg-gray-900 p-4 rounded border border-gray-800 text-sm"
            >
              <div class="flex items-center justify-between">
                <span class="font-medium text-gray-300">Прозрачность</span>
                <span class="text-xs font-mono text-gray-500">{{ Math.round((selectedClip.opacity ?? 1) * 100) }}%</span>
              </div>
              <USlider
                :model-value="selectedClip.opacity ?? 1"
                :min="0"
                :max="1"
                :step="0.01"
                @update:model-value="handleUpdateOpacity"
              />
            </div>

            <EffectsEditor
              :effects="selectedClip.effects"
              :titlv-if="canEditAudioGain" e="t('granVideoEditor.effects.clipTitle', 'Clip effects')"
              :add-label="t('granVideoEditor.effects.add', 'Add')"
              :empty-label="t('granVideoEditor.effects.empty', 'No effects')"
              @update:effects="handleUpdateClipEffects"
            />

            <div
              v-if="canEditAudioFades && (selectedClipTrack?.kind === 'audio' || selectedClipTrack?.kind === 'video')"
              class="space-y-4 mt-2 bg-gray-900 p-4 rounded border border-gray-800 text-sm"
            >
              <div class="flex items-center justify-between">
                <span class="font-medium text-gray-300">{{ t('granVideoEditor.clip.audioFade.title', 'Audio fades') }}</span>
              </div>

              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <span class="text-gray-500">{{ t('granVideoEditor.clip.audio.volume', 'Volume') }}</span>
                  <span class="text-xs font-mono text-gray-500">{{ audioGain.toFixed(2) }}x</span>
                </div>
                <USlider
                  :model-value="audioGain"
                  :min="0"
                  :max="2"
                  :step="0.01"
                  @update:model-value="handleUpdateAudioGain"
                />
              </div>

              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <span class="text-gray-500">{{ t('granVideoEditor.clip.audioFade.fadeIn', 'Fade in') }}</span>
                  <span class="text-xs font-mono text-gray-500">{{ audioFadeInSec.toFixed(2) }}s</span>
                </div>
                <USlider
                  :model-value="audioFadeInSec"
                  :min="0"
                  :max="audioFadeMaxSec"
                  :step="0.05"
                  @update:model-value="(v: any) => (audioFadeInSec = Number(v))"
                />
              </div>

              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <span class="text-gray-500">{{ t('granVideoEditor.clip.audioFade.fadeOut', 'Fade out') }}</span>
                  <span class="text-xs font-mono text-gray-500">{{ audioFadeOutSec.toFixed(2) }}s</span>
                </div>
                <USlider
                  :model-value="audioFadeOutSec"
                  :min="0"
                  :max="audioFadeMaxSec"
                  :step="0.05"
                  @update:model-value="(v: any) => (audioFadeOutSec = Number(v))"
                />
              </div>
            </div>

            <div
              v-if="canEditTransform"
              class="space-y-3 mt-2 bg-gray-900 p-4 rounded border border-gray-800 text-sm"
            >
              <div class="flex items-center justify-between">
                <span class="font-medium text-gray-300">Transform</span>
              </div>

              <div class="grid grid-cols-2 gap-3">
                <div class="flex flex-col gap-1">
                  <span class="text-gray-500">Scale X</span>
                  <UInput v-model.number="transformScaleX" size="sm" type="number" step="0.01" />
                </div>
                <div class="flex flex-col gap-1">
                  <span class="text-gray-500">Scale Y</span>
                  <UInput v-model.number="transformScaleY" size="sm" type="number" step="0.01" />
                </div>
              </div>

              <div class="flex items-center justify-between">
                <span class="text-gray-500">Linked scale</span>
                <UCheckbox v-model="transformScaleLinked" />
              </div>

              <div class="flex flex-col gap-1">
                <span class="text-gray-500">Rotation (deg)</span>
                <UInput v-model.number="transformRotationDeg" size="sm" type="number" step="0.1" />
              </div>

              <div class="grid grid-cols-2 gap-3">
                <div class="flex flex-col gap-1">
                  <span class="text-gray-500">Position X</span>
                  <UInput v-model.number="transformPosX" size="sm" type="number" step="1" />
                </div>
                <div class="flex flex-col gap-1">
                  <span class="text-gray-500">Position Y</span>
                  <UInput v-model.number="transformPosY" size="sm" type="number" step="1" />
                </div>
              </div>

              <div class="flex flex-col gap-1">
                <span class="text-gray-500">Anchor</span>
                <USelect v-model="transformAnchorPreset" :options="anchorPresetOptions" size="sm" />
              </div>

              <div v-if="transformAnchorPreset === 'custom'" class="grid grid-cols-2 gap-3">
                <div class="flex flex-col gap-1">
                  <span class="text-gray-500">Anchor X (0..1)</span>
                  <UInput v-model.number="transformAnchorX" size="sm" type="number" step="0.01" />
                </div>
                <div class="flex flex-col gap-1">
                  <span class="text-gray-500">Anchor Y (0..1)</span>
                  <UInput v-model.number="transformAnchorY" size="sm" type="number" step="0.01" />
                </div>
              </div>
            </div>
          </div>

          <div v-else-if="displayMode === 'track' && selectedTrack" class="w-full flex flex-col gap-4">
            <div class="flex items-center gap-3">
              <UIcon
                :name="selectedTrack.kind === 'video' ? 'i-heroicons-video-camera' : 'i-heroicons-musical-note'"
                class="w-10 h-10 shrink-0"
                :class="selectedTrack.kind === 'video' ? 'text-indigo-400' : 'text-teal-400'"
              />
              <div class="min-w-0">
                <h3 class="font-medium text-lg truncate">{{ selectedTrack.name }}</h3>
                <span class="text-xs text-gray-400 uppercase">
                  {{ selectedTrack.kind === 'video' ? t('common.video', 'Video Track') : t('common.audio', 'Audio Track') }}
                </span>
              </div>
            </div>

            <div class="space-y-2 mt-2 bg-gray-900 p-4 rounded border border-gray-800 text-sm">
              <div class="flex flex-col gap-1">
                <span class="text-gray-500">{{ t('common.name', 'Name') }}</span>
                <span class="font-medium break-all">{{ selectedTrack.name }}</span>
              </div>
            </div>

            <EffectsEditor
              :effects="selectedTrack.effects"
              :title="t('granVideoEditor.effects.trackTitle', 'Track effects')"
              :add-label="t('granVideoEditor.effects.add', 'Add')"
              :empty-label="t('granVideoEditor.effects.empty', 'No effects')"
              @update:effects="handleUpdateTrackEffects"
            />
          </div>

          <!-- File Preview & Properties -->
          <div v-else-if="displayMode === 'file'" class="w-full flex flex-col gap-4">
            <!-- Preview Box -->
            <div
              class="w-full bg-black rounded border border-gray-800 flex items-center justify-center min-h-50 overflow-hidden shrink-0"
            >
              <div v-if="isUnknown" class="flex flex-col items-center gap-3 text-gray-700 p-8">
                <UIcon name="i-heroicons-document" class="w-16 h-16" />
                <p class="text-sm text-center">
                  {{
                    t(
                      'granVideoEditor.preview.unsupported',
                      'Unsupported file format for visual preview',
                    )
                  }}
                </p>
              </div>

              <template v-else-if="currentUrl">
                <img
                  v-if="mediaType === 'image'"
                  :src="currentUrl"
                  class="max-w-full max-h-64 object-contain"
                />
                <MediaPlayer
                  v-else-if="mediaType === 'video' || mediaType === 'audio'"
                  :src="currentUrl"
                  :type="mediaType"
                  class="w-full h-64"
                />
              </template>

              <pre
                v-else-if="mediaType === 'text'"
                class="w-full max-h-64 overflow-auto p-4 text-xs font-mono text-gray-300 whitespace-pre-wrap"
                >{{ textContent }}</pre
              >
            </div>

            <!-- File Info -->
            <div
              v-if="fileInfo"
              class="space-y-2 bg-gray-900 p-4 rounded border border-gray-800 text-sm w-full"
            >
              <div class="flex flex-col gap-1 border-b border-gray-800 pb-2">
                <span class="text-gray-500">{{ t('common.name', 'Name') }}</span>
                <span class="font-medium text-white break-all">{{ fileInfo.name }}</span>
              </div>
              <div
                v-if="fileInfo.size !== undefined"
                class="flex flex-col gap-1 border-b border-gray-800 pb-2"
              >
                <span class="text-gray-500">{{ t('common.size', 'Size') }}</span>
                <span class="font-medium text-white">{{ formatMegabytes(fileInfo.size) }}</span>
              </div>
              <div
                v-if="fileInfo.lastModified"
                class="flex flex-col gap-1 pb-2"
                :class="{ 'border-b border-gray-800': metadataYaml }"
              >
                <span class="text-gray-500">{{ t('common.modified', 'Modified') }}</span>
                <span class="font-medium text-white">{{
                  new Date(fileInfo.lastModified).toLocaleString()
                }}</span>
              </div>
              <div v-if="metadataYaml" class="flex flex-col gap-1 pt-2">
                <span class="text-gray-500">{{
                  t('videoEditor.fileManager.info.metadata', 'Metadata')
                }}</span>
                <pre
                  class="bg-gray-950 p-2 rounded text-[10px] font-mono overflow-auto max-h-40 whitespace-pre text-gray-400"
                  >{{ metadataYaml }}</pre
                >
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <RenameModal
      v-model:open="isRenameModalOpen"
      :initial-name="selectedClip?.name"
      @rename="handleRenameClip"
    />
  </div>
</template>
