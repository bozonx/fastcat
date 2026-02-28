<script setup lang="ts">
import { ref, watch, onUnmounted, computed } from 'vue';
import { useUiStore } from '~/stores/ui.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useMediaStore } from '~/stores/media.store';
import { useProxyStore } from '~/stores/proxy.store';
import { useFocusStore } from '~/stores/focus.store';
import { useSelectionStore } from '~/stores/selection.store';
import type { TimelineClipItem, TimelineTrack } from '~/timeline/types';
import yaml from 'js-yaml';
import RenameModal from '~/components/common/RenameModal.vue';
import EffectsEditor from '~/components/common/EffectsEditor.vue';
import DurationSliderInput from '~/components/ui/DurationSliderInput.vue';
import WheelSlider from '~/components/ui/WheelSlider.vue';
import ClipTransitionPanel from '~/components/timeline/ClipTransitionPanel.vue';
import { isEditableTarget } from '~/utils/hotkeys/hotkeyUtils';

defineOptions({
  name: 'PreviewPanel',
});

const { t } = useI18n();
const uiStore = useUiStore();
const timelineStore = useTimelineStore();
const mediaStore = useMediaStore();
const proxyStore = useProxyStore();
const focusStore = useFocusStore();
const selectionStore = useSelectionStore();

function clearAllSelection() {
  selectionStore.clearSelection();
  timelineStore.clearSelection();
  timelineStore.selectTrack(null);
}

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

interface FsDirectoryHandleWithIteration extends FileSystemDirectoryHandle {
  values?: () => AsyncIterable<FileSystemHandle>;
  entries?: () => AsyncIterable<[string, FileSystemHandle]>;
}

async function computeDirectorySize(
  dirHandle: FileSystemDirectoryHandle,
  options?: { maxEntries?: number },
): Promise<number | undefined> {
  const maxEntries = options?.maxEntries ?? 25_000;
  let seen = 0;

  async function walk(handle: FileSystemDirectoryHandle): Promise<number> {
    const iterator = (handle as FsDirectoryHandleWithIteration).values?.() ??
      (handle as FsDirectoryHandleWithIteration).entries?.();
    if (!iterator) return 0;

    let total = 0;
    for await (const value of iterator) {
      if (seen >= maxEntries) {
        throw new Error('Directory too large');
      }
      seen += 1;

      const entryHandle = (Array.isArray(value) ? value[1] : value) as
        | FileSystemFileHandle
        | FileSystemDirectoryHandle;

      if (entryHandle.kind === 'file') {
        try {
          const f = await (entryHandle as FileSystemFileHandle).getFile();
          total += f.size;
        } catch {
          // ignore
        }
      } else {
        total += await walk(entryHandle as FileSystemDirectoryHandle);
      }
    }
    return total;
  }

  try {
    return await walk(dirHandle);
  } catch {
    return undefined;
  }
}

const selectedClip = computed<TimelineClipItem | null>(() => {
  const entity = selectionStore.selectedEntity;
  if (entity?.source !== 'timeline' || entity.kind !== 'clip') return null;
  const track = timelineStore.timelineDoc?.tracks.find((t) => t.id === entity.trackId);
  const item = track?.items.find((it) => it.id === entity.itemId);
  return item && item.kind === 'clip' ? (item as TimelineClipItem) : null;
});

const selectedTransition = computed(() => {
  const entity = selectionStore.selectedEntity;
  if (entity?.source !== 'timeline' || entity.kind !== 'transition') return null;
  return { trackId: entity.trackId, itemId: entity.itemId, edge: entity.edge };
});

const selectedTransitionClip = computed<TimelineClipItem | null>(() => {
  const sel = selectedTransition.value;
  if (!sel) return null;
  const track = timelineStore.timelineDoc?.tracks.find((t) => t.id === sel.trackId);
  const item = track?.items.find((it) => it.id === sel.itemId);
  return item && item.kind === 'clip' ? (item as TimelineClipItem) : null;
});

const selectedTransitionValue = computed<import('~/timeline/types').ClipTransition | undefined>(
  () => {
    const sel = selectedTransition.value;
    const clip = selectedTransitionClip.value as any;
    if (!sel || !clip) return undefined;
    return sel.edge === 'in' ? clip.transitionIn : clip.transitionOut;
  },
);

const selectedTrack = computed<TimelineTrack | null>(() => {
  const entity = selectionStore.selectedEntity;
  if (entity?.source !== 'timeline' || entity.kind !== 'track') return null;
  const tracks = (timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined) ?? [];
  return tracks.find((t) => t.id === entity.trackId) ?? null;
});

const trackAudioGain = computed({
  get: () => {
    const track = selectedTrack.value as any;
    const v =
      typeof track?.audioGain === 'number' && Number.isFinite(track.audioGain)
        ? track.audioGain
        : 1;
    return Math.max(0, Math.min(2, v));
  },
  set: (val: number) => {
    if (!selectedTrack.value) return;
    const track = selectedTrack.value as any;
    const v = Math.max(0, Math.min(2, Number(val)));
    timelineStore.updateTrackProperties(track.id, { audioGain: v });
  },
});

const trackAudioBalance = computed({
  get: () => {
    const track = selectedTrack.value as any;
    const v =
      typeof track?.audioBalance === 'number' && Number.isFinite(track.audioBalance)
        ? track.audioBalance
        : 0;
    return Math.max(-1, Math.min(1, v));
  },
  set: (val: number) => {
    if (!selectedTrack.value) return;
    const track = selectedTrack.value as any;
    const v = Math.max(-1, Math.min(1, Number(val)));
    timelineStore.updateTrackProperties(track.id, { audioBalance: v });
  },
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

function handleUpdateAudioBalance(val: unknown) {
  if (!selectedClip.value) return;
  const v = typeof val === 'number' && Number.isFinite(val) ? val : Number(val);
  const safe = Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
  timelineStore.updateClipProperties(selectedClip.value.trackId, selectedClip.value.id, {
    audioBalance: safe,
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
  const curr = ((selectedClip.value as any).style ??
    {}) as import('~/timeline/types').TextClipStyle;
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
    const y = linked ? x : (current.scale?.y ?? 1);
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
    const x = linked ? y : (current.scale?.x ?? 1);
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

  const entity = selectionStore.selectedEntity;
  if (entity?.source === 'fileManager' && (entity.kind === 'file' || entity.kind === 'directory'))
    return 'file';

  return 'empty';
});

const selectedFsEntry = computed(() => {
  const entity = selectionStore.selectedEntity;
  if (entity?.source === 'fileManager' && (entity.kind === 'file' || entity.kind === 'directory')) {
    return entity.entry;
  }
  return null;
});

const hasProxy = computed(() => {
  if (displayMode.value !== 'file' || !selectedFsEntry.value || !selectedFsEntry.value.path)
    return false;
  return proxyStore.existingProxies.has(selectedFsEntry.value.path);
});

const selectedClipTrack = computed<TimelineTrack | null>(() => {
  const clip = selectedClip.value;
  if (!clip) return null;
  return (
    (timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined)?.find(
      (t) => t.id === clip.trackId,
    ) ?? null
  );
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
  const track = timelineStore.timelineDoc?.tracks.find((t) => t.id === clip.trackId);
  if (track?.kind === 'video' && (clip as any).audioFromVideoDisabled) return false;

  if (clip.source?.path) {
    const meta = mediaStore.mediaMetadata[clip.source.path];
    if (!meta?.audio) return false;
  }

  return true;
});

const canEditAudioBalance = computed(() => {
  return canEditAudioGain.value;
});

const audioGain = computed({
  get: () => {
    const clip = selectedClip.value as any;
    const v =
      typeof clip?.audioGain === 'number' && Number.isFinite(clip.audioGain) ? clip.audioGain : 1;
    return Math.max(0, Math.min(2, v));
  },
  set: (val: number) => {
    if (!selectedClip.value) return;
    const current = selectedClip.value as any;
    const v = Math.max(0, Math.min(2, Number(val)));
    timelineStore.updateClipProperties(current.trackId, current.id, { audioGain: v });
  },
});

const audioBalance = computed({
  get: () => {
    const clip = selectedClip.value as any;
    const v =
      typeof clip?.audioBalance === 'number' && Number.isFinite(clip.audioBalance)
        ? clip.audioBalance
        : 0;
    return Math.max(-1, Math.min(1, v));
  },
  set: (val: number) => {
    if (!selectedClip.value) return;
    const current = selectedClip.value as any;
    const v = Math.max(-1, Math.min(1, Number(val)));
    timelineStore.updateClipProperties(current.trackId, current.id, { audioBalance: v });
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
    const v =
      typeof clip?.audioFadeInUs === 'number' && Number.isFinite(clip.audioFadeInUs)
        ? clip.audioFadeInUs
        : 0;
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
    const v =
      typeof clip?.audioFadeOutUs === 'number' && Number.isFinite(clip.audioFadeOutUs)
        ? clip.audioFadeOutUs
        : 0;
    return Math.max(0, v / 1_000_000);
  },
  set: (val: number) => {
    if (!selectedClip.value) return;
    const current = selectedClip.value as any;
    const v = Math.max(0, Math.min(val, clipDurationSec.value)) * 1_000_000;
    timelineStore.updateClipProperties(current.trackId, current.id, { audioFadeOutUs: v });
  },
});

const audioFadeInMaxSec = computed(() => {
  const clip = selectedClip.value as any;
  if (!clip) return 0;
  const opp =
    typeof clip.audioFadeOutUs === 'number' && Number.isFinite(clip.audioFadeOutUs)
      ? clip.audioFadeOutUs
      : 0;
  return Math.max(0, (Number(clip.timelineRange?.durationUs ?? 0) - opp) / 1_000_000);
});

const audioFadeOutMaxSec = computed(() => {
  const clip = selectedClip.value as any;
  if (!clip) return 0;
  const opp =
    typeof clip.audioFadeInUs === 'number' && Number.isFinite(clip.audioFadeInUs)
      ? clip.audioFadeInUs
      : 0;
  return Math.max(0, (Number(clip.timelineRange?.durationUs ?? 0) - opp) / 1_000_000);
});

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

  const entry = selectedFsEntry.value;
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
  () => selectedFsEntry.value,
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

    if (!entry) return;

    if (entry.kind === 'directory') {
      fileInfo.value = {
        name: entry.name,
        kind: 'directory',
        size: await computeDirectorySize(entry.handle as FileSystemDirectoryHandle),
      };
      return;
    }

    try {
      const file = await (entry.handle as FileSystemFileHandle).getFile();

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

      fileInfo.value = {
        name: file.name,
        kind: 'file',
        size: file.size,
        lastModified: file.lastModified,
        metadata:
          entry.path && (mediaType.value === 'video' || mediaType.value === 'audio')
            ? await mediaStore.getOrFetchMetadata(
                entry.handle as FileSystemFileHandle,
                entry.path,
                {
                  forceRefresh: true,
                },
              )
            : undefined,
      };

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
  if (!selectedClip.value) return;
  const clip = selectedClip.value;
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
  if (!selectedClip.value) return;
  const clip = selectedClip.value;
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

function onPanelFocusIn(e: FocusEvent) {
  if (!isEditableTarget(e.target)) return;
  focusStore.setTempFocus('right');
}

function onPanelFocusOut() {
  // We no longer automatically clear temp focus on blur
}
</script>

<template>
  <div
    class="flex flex-col h-full bg-ui-bg-elevated border-r border-ui-border min-w-0 relative"
    :class="{
      'outline-2 outline-primary-500/60 -outline-offset-2 z-10': focusStore.isPanelFocused('right'),
    }"
    @pointerdown.capture="focusStore.setTempFocus('right')"
    @focusin.capture="onPanelFocusIn"
    @focusout.capture="onPanelFocusOut"
  >
    <!-- Header -->
    <div
      v-if="displayMode !== 'empty'"
      class="flex items-center justify-between px-2 py-1.5 border-b border-ui-border shrink-0"
    >
      <div class="flex items-center overflow-hidden min-w-0">
        <span
          v-if="displayMode === 'clip'"
          class="ml-2 text-xs text-ui-text-muted font-mono truncate"
        >
          {{ selectedClip?.name }}
        </span>
        <span
          v-else-if="displayMode === 'transition'"
          class="ml-2 text-xs text-ui-text-muted font-mono truncate"
        >
          {{ selectedTransitionClip?.name }}
        </span>
        <span
          v-else-if="displayMode === 'file' && selectedFsEntry"
          class="ml-2 text-xs text-ui-text-muted font-mono truncate"
        >
          {{ selectedFsEntry.name }}
        </span>
        <span
          v-else-if="displayMode === 'track' && selectedTrack"
          class="ml-2 text-xs text-ui-text-muted font-mono truncate"
        >
          {{ selectedTrack.name }}
        </span>
      </div>
      <div class="flex gap-1 shrink-0 ml-2">
        <UButton
          size="xs"
          variant="ghost"
          color="neutral"
          icon="i-heroicons-x-mark"
          @click="clearAllSelection"
        />
        <div v-if="displayMode === 'clip'" class="flex gap-1">
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
        <div v-else-if="displayMode === 'file' && hasProxy" class="flex gap-1">
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
    </div>

    <!-- Content Area -->
    <div class="flex-1 min-h-0 bg-ui-bg relative">
      <div class="absolute inset-0 overflow-auto">
        <div class="flex flex-col p-2 items-start w-full">
          <div
            v-if="displayMode === 'empty'"
            key="empty"
            class="w-full flex items-center justify-center text-ui-text-muted min-h-50"
          >
            <p class="text-xs">
              {{ t('granVideoEditor.preview.noSelection', 'No item selected') }}
            </p>
          </div>

          <!-- Transition Properties -->
          <div
            v-else-if="displayMode === 'transition' && selectedTransition && selectedTransitionClip"
            key="transition"
            class="w-full flex flex-col gap-2 text-ui-text"
          >
            <div
              class="text-xs font-semibold text-ui-text uppercase tracking-wide border-b border-ui-border pb-1"
            >
              {{ selectedTransition.edge === 'in' ? 'Transition In' : 'Transition Out' }}
            </div>

            <ClipTransitionPanel
              :edge="selectedTransition.edge"
              :track-id="selectedTransition.trackId"
              :item-id="selectedTransition.itemId"
              :transition="selectedTransitionValue"
              @update="handleTransitionUpdate"
            />
          </div>

          <!-- Clip Properties -->
          <div
            v-else-if="displayMode === 'clip' && selectedClip"
            key="clip"
            class="w-full flex flex-col gap-2 text-ui-text"
          >
            <div
              class="text-xs font-semibold text-ui-text uppercase tracking-wide border-b border-ui-border pb-1"
            >
              {{ selectedClip.name }}
            </div>

            <div class="space-y-2 bg-ui-bg-elevated p-2 rounded border border-ui-border text-xs">
              <div
                v-if="selectedClip.clipType === 'media'"
                class="flex flex-col gap-0.5 border-b border-ui-border pb-1.5"
              >
                <span class="text-ui-text-muted text-xs">{{
                  t('common.source', 'Source File')
                }}</span>
                <span class="font-medium break-all text-xs">{{ selectedClip.source.path }}</span>
              </div>
              <div
                v-else-if="selectedClip.clipType === 'background'"
                class="flex flex-col gap-0.5 border-b border-ui-border pb-1.5"
              >
                <span class="text-ui-text-muted text-xs">{{ t('common.color', 'Color') }}</span>
                <div class="flex items-center justify-between gap-3">
                  <span class="font-mono text-xs text-ui-text">{{
                    selectedClip.backgroundColor
                  }}</span>
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
                class="flex flex-col gap-1.5 border-b border-ui-border pb-1.5"
              >
                <span class="text-ui-text-muted text-xs">{{
                  t('granVideoEditor.textClip.text', 'Text')
                }}</span>
                <UTextarea
                  :model-value="(selectedClip as any).text"
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
                      :model-value="Number((selectedClip as any).style?.fontSize ?? 64)"
                      size="sm"
                      type="number"
                      step="1"
                      @update:model-value="
                        (v: any) => handleUpdateTextStyle({ fontSize: Number(v) })
                      "
                    />
                  </div>
                  <div class="flex flex-col gap-0.5">
                    <span class="text-xs text-ui-text-muted">{{ t('common.color', 'Color') }}</span>
                    <UColorPicker
                      :model-value="String((selectedClip as any).style?.color ?? '#ffffff')"
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
                    :model-value="String((selectedClip as any).style?.align ?? 'center')"
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
                    :model-value="String((selectedClip as any).style?.verticalAlign ?? 'middle')"
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
                      :model-value="Number((selectedClip as any).style?.lineHeight ?? 1.2)"
                      size="sm"
                      type="number"
                      step="0.1"
                      @update:model-value="
                        (v: any) => handleUpdateTextStyle({ lineHeight: Number(v) })
                      "
                    />
                  </div>
                  <div class="flex flex-col gap-0.5">
                    <span class="text-xs text-ui-text-muted">{{
                      t('granVideoEditor.textClip.letterSpacing', 'Letter spacing')
                    }}</span>
                    <UInput
                      :model-value="Number((selectedClip as any).style?.letterSpacing ?? 0)"
                      size="sm"
                      type="number"
                      step="1"
                      @update:model-value="
                        (v: any) => handleUpdateTextStyle({ letterSpacing: Number(v) })
                      "
                    />
                  </div>
                </div>

                <div class="flex flex-col gap-0.5">
                  <span class="text-xs text-ui-text-muted">{{
                    t('granVideoEditor.textClip.backgroundColor', 'Background')
                  }}</span>
                  <UColorPicker
                    :model-value="String((selectedClip as any).style?.backgroundColor ?? '')"
                    format="hex"
                    size="sm"
                    @update:model-value="
                      (v: any) => handleUpdateTextStyle({ backgroundColor: String(v) })
                    "
                  />
                </div>

                <div class="flex flex-col gap-0.5">
                  <span class="text-xs text-ui-text-muted">{{
                    t('granVideoEditor.textClip.padding', 'Padding')
                  }}</span>
                  <UInput
                    :model-value="Number((selectedClip as any).style?.padding ?? 60)"
                    size="sm"
                    type="number"
                    step="1"
                    @update:model-value="(v: any) => handleUpdateTextStyle({ padding: Number(v) })"
                  />
                </div>
              </div>
              <div class="flex flex-col gap-0.5 border-b border-ui-border pb-1.5">
                <span class="text-xs text-ui-text-muted">{{
                  t('common.start', 'Start Time')
                }}</span>
                <span class="font-mono text-xs">{{
                  formatTime(selectedClip.timelineRange.startUs)
                }}</span>
              </div>
              <div class="flex flex-col gap-0.5 pb-1.5">
                <span class="text-xs text-ui-text-muted">{{
                  t('common.duration', 'Duration')
                }}</span>
                <span class="font-mono text-xs">{{
                  formatTime(selectedClip.timelineRange.durationUs)
                }}</span>
              </div>
            </div>

            <!-- Quick Transitions -->
            <div
              v-if="selectedClip.trackId.startsWith('v')"
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
                    :color="(selectedClip as any).transitionIn ? 'red' : 'primary'"
                    variant="ghost"
                    :icon="
                      (selectedClip as any).transitionIn
                        ? 'i-heroicons-trash'
                        : 'i-heroicons-plus-circle'
                    "
                    @click="toggleTransition('in')"
                  />
                </div>
                <div
                  v-if="(selectedClip as any).transitionIn"
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
                          trackId: selectedClip.trackId,
                          itemId: selectedClip.id,
                          edge: 'in',
                        })
                      "
                    >
                      {{ (selectedClip as any).transitionIn.type }}
                    </UButton>
                    <span class="text-[10px] font-mono text-ui-text-muted">
                      {{ formatTime((selectedClip as any).transitionIn.durationUs) }}
                    </span>
                  </div>
                  <DurationSliderInput
                    :model-value="(selectedClip as any).transitionIn.durationUs / 1_000_000"
                    :min="0.1"
                    :max="
                      Math.max(
                        0.1,
                        (selectedClip.timelineRange.durationUs -
                          ((selectedClip as any).transitionOut?.durationUs ?? 0)) /
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
                    :color="(selectedClip as any).transitionOut ? 'red' : 'primary'"
                    variant="ghost"
                    :icon="
                      (selectedClip as any).transitionOut
                        ? 'i-heroicons-trash'
                        : 'i-heroicons-plus-circle'
                    "
                    @click="toggleTransition('out')"
                  />
                </div>
                <div
                  v-if="(selectedClip as any).transitionOut"
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
                          trackId: selectedClip.trackId,
                          itemId: selectedClip.id,
                          edge: 'out',
                        })
                      "
                    >
                      {{ (selectedClip as any).transitionOut.type }}
                    </UButton>
                    <span class="text-[10px] font-mono text-ui-text-muted">
                      {{ formatTime((selectedClip as any).transitionOut.durationUs) }}
                    </span>
                  </div>
                  <DurationSliderInput
                    :model-value="(selectedClip as any).transitionOut.durationUs / 1_000_000"
                    :min="0.1"
                    :max="
                      Math.max(
                        0.1,
                        (selectedClip.timelineRange.durationUs -
                          ((selectedClip as any).transitionIn?.durationUs ?? 0)) /
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
              v-if="selectedClip.clipType !== 'adjustment'"
              class="space-y-1.5 bg-ui-bg-elevated p-2 rounded border border-ui-border"
            >
              <div class="flex items-center justify-between">
                <span class="text-xs font-semibold text-ui-text uppercase tracking-wide"
                  >Прозрачность</span
                >
                <span class="text-xs font-mono text-ui-text-muted"
                  >{{ Math.round((selectedClip.opacity ?? 1) * 100) }}%</span
                >
              </div>
              <WheelSlider
                :model-value="selectedClip.opacity ?? 1"
                :min="0"
                :max="1"
                :step="0.01"
                @update:model-value="handleUpdateOpacity"
              />
            </div>

            <EffectsEditor
              :effects="selectedClip.effects"
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
                  <span class="text-xs font-mono text-ui-text-muted"
                    >{{ audioGain.toFixed(3) }}x</span
                  >
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
                  <span class="text-xs font-mono text-ui-text-muted">{{
                    audioBalance.toFixed(2)
                  }}</span>
                </div>
                <WheelSlider
                  :model-value="audioBalance"
                  :min="-1"
                  :max="1"
                  :step="0.01"
                  @update:model-value="handleUpdateAudioBalance"
                />
              </div>

              <div class="space-y-1.5">
                <div class="flex items-center justify-between">
                  <span class="text-xs text-ui-text-muted">{{
                    t('granVideoEditor.clip.audioFade.fadeIn', 'Fade in')
                  }}</span>
                </div>
                <DurationSliderInput
                  v-model="audioFadeInSec"
                  :min="0"
                  :max="audioFadeInMaxSec"
                  :step="0.01"
                  unit="s"
                  :decimals="2"
                />
              </div>

              <div class="space-y-1.5">
                <div class="flex items-center justify-between">
                  <span class="text-xs text-ui-text-muted">{{
                    t('granVideoEditor.clip.audioFade.fadeOut', 'Fade out')
                  }}</span>
                </div>
                <DurationSliderInput
                  v-model="audioFadeOutSec"
                  :min="0"
                  :max="audioFadeOutMaxSec"
                  :step="0.01"
                  unit="s"
                  :decimals="2"
                />
              </div>
            </div>

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
          </div>

          <div
            v-else-if="displayMode === 'track' && selectedTrack"
            key="track"
            class="w-full flex flex-col gap-2"
          >
            <div
              class="text-xs font-semibold text-ui-text uppercase tracking-wide border-b border-ui-border pb-1"
            >
              {{ selectedTrack.name }}
            </div>

            <div
              v-if="selectedTrack.kind === 'audio' || selectedTrack.kind === 'video'"
              class="space-y-2 bg-ui-bg-elevated p-2 rounded border border-ui-border"
            >
              <div
                class="text-xs font-semibold text-ui-text uppercase tracking-wide border-b border-ui-border pb-1"
              >
                {{ t('granVideoEditor.track.audio.title', 'Track audio') }}
              </div>

              <div class="space-y-1.5">
                <div class="flex items-center justify-between">
                  <span class="text-xs text-ui-text-muted">{{
                    t('granVideoEditor.track.audio.volume', 'Volume')
                  }}</span>
                  <span class="text-xs font-mono text-ui-text-muted"
                    >{{ trackAudioGain.toFixed(3) }}x</span
                  >
                </div>
                <WheelSlider
                  :model-value="trackAudioGain"
                  :min="0"
                  :max="2"
                  :step="0.001"
                  @update:model-value="(v: any) => (trackAudioGain = Number(v))"
                />
              </div>

              <div class="space-y-1.5">
                <div class="flex items-center justify-between">
                  <span class="text-xs text-ui-text-muted">{{
                    t('granVideoEditor.track.audio.balance', 'Balance')
                  }}</span>
                  <span class="text-xs font-mono text-ui-text-muted">{{
                    trackAudioBalance.toFixed(2)
                  }}</span>
                </div>
                <WheelSlider
                  :model-value="trackAudioBalance"
                  :min="-1"
                  :max="1"
                  :step="0.01"
                  @update:model-value="(v: any) => (trackAudioBalance = Number(v))"
                />
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
          <div v-else-if="displayMode === 'file'" key="file" class="w-full flex flex-col gap-4">
            <!-- Preview Box -->
            <div
              class="w-full bg-ui-bg rounded border border-ui-border flex flex-col items-center justify-center min-h-50 overflow-hidden shrink-0"
            >
              <div v-if="isUnknown" class="flex flex-col items-center gap-3 text-ui-text-muted p-8 w-full h-full justify-center">
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

              <div v-else-if="currentUrl" class="w-full h-full flex flex-col">
                <img
                  v-if="mediaType === 'image'"
                  :src="currentUrl"
                  class="max-w-full max-h-64 object-contain mx-auto my-auto"
                />
                <MediaPlayer
                  v-else-if="mediaType === 'video' || mediaType === 'audio'"
                  :src="currentUrl"
                  :type="mediaType"
                  class="w-full h-64"
                />
              </div>

              <pre
                v-else-if="mediaType === 'text'"
                class="w-full max-h-64 overflow-auto p-4 text-xs font-mono text-ui-text whitespace-pre-wrap"
                >{{ textContent }}</pre
              >
            </div>

            <!-- File Info -->
            <div
              v-if="fileInfo"
              class="space-y-1.5 bg-ui-bg-elevated p-2 rounded border border-ui-border text-xs w-full"
            >
              <div class="flex flex-col gap-0.5 border-b border-ui-border pb-1.5">
                <span class="text-xs text-ui-text-muted">{{ t('common.name', 'Name') }}</span>
                <span class="font-medium text-ui-text break-all">{{ fileInfo.name }}</span>
              </div>
              <div
                v-if="fileInfo.size !== undefined"
                class="flex flex-col gap-0.5 border-b border-ui-border pb-1.5"
              >
                <span class="text-xs text-ui-text-muted">{{ t('common.size', 'Size') }}</span>
                <span class="font-medium text-ui-text">{{ formatMegabytes(fileInfo.size) }}</span>
              </div>
              <div
                v-if="fileInfo.lastModified !== undefined"
                class="flex flex-col gap-0.5 pb-1.5"
                :class="{ 'border-b border-ui-border': metadataYaml }"
              >
                <span class="text-xs text-ui-text-muted">{{
                  t('common.modified', 'Modified')
                }}</span>
                <span class="font-medium text-ui-text">{{
                  new Date(fileInfo.lastModified).toLocaleString()
                }}</span>
              </div>
              <div v-if="metadataYaml" class="flex flex-col gap-0.5 pt-1.5">
                <span class="text-xs text-ui-text-muted">{{
                  t('videoEditor.fileManager.info.metadata', 'Metadata')
                }}</span>
                <pre
                  class="bg-ui-bg p-2 rounded text-[10px] font-mono overflow-auto max-h-40 whitespace-pre text-ui-text-muted"
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
