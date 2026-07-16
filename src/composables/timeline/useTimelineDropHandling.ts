import { createDevLogger } from '~/utils/dev-logger';
import { ref, type Ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useMediaStore } from '~/stores/media.store';
import { useTimelineSettingsStore } from '~/stores/timeline-settings.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { computeSnappedStartTicks, pxToTimeTicks } from '~/utils/timeline/geometry';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import { getWorkspacePathFileName } from '~/utils/workspace-common';
import { isLayer1Pressed } from '~/utils/hotkeys/layerUtils';
import type { HudType, ShapeType } from '~/timeline/types';
import { selectTimelineDurationTicks } from '~/timeline/selectors';
import { useUiStore } from '~/stores/ui.store';
import { useTimelineTextPreset } from './useTimelineTextPreset';
import { useAppClipboard } from '~/composables/useAppClipboard';
import { crossVfsCopy } from '~/file-manager/core/vfs/crossVfs';
import { LARGE_UPLOAD_BACKGROUND_THRESHOLD_BYTES } from '~/file-manager/application/fileManagerCommands';
import { parseTimelineFromOtio } from '~/timeline/otio-serializer';
import { assertNoOverlap, quantizeTicksToFrames, sanitizeFps } from '~/timeline/commands/utils';
import { secondsToTicksClamped } from '~/utils/time';
import { withFileIoSlot } from '~/utils/io/io-governor';
import { useUploadProgress } from '~/composables/useUploadProgress';
import { computeSnapTargetsTicks } from './timeline-drag-domain';
const log = createDevLogger('useTimelineDropHandling');

export interface UseTimelineDropHandlingOptions {
  scrollEl: Ref<HTMLElement | null>;
}

interface DragPreview {
  trackId: string;
  startTicks: number;
  label: string;
  durationTicks: number;
  kind: 'timeline-clip' | 'file';
  invalid?: boolean;
}

interface TimelineDropItem {
  kind?: 'file' | 'timeline' | 'adjustment' | 'background' | 'text' | 'shape' | 'hud';
  name?: string;
  path?: string;
  type?: string;
  presetParams?: Record<string, unknown>;
  isRightClick?: boolean;
  isExternal?: boolean;
}

interface TimelineDropContext {
  baseTrackId: string;
  currentStartTicks: number;
  pseudo: boolean;
}

interface TimelineDropResult {
  nextStartTicks: number;
  added: boolean;
  trackId?: string;
  itemId?: string;
}

interface TimelineDropStrategy {
  canHandle: (item: TimelineDropItem) => boolean;
  execute: (item: TimelineDropItem, context: TimelineDropContext) => Promise<TimelineDropResult>;
}

export function useTimelineDropHandling(options: UseTimelineDropHandlingOptions) {
  const { scrollEl } = options;
  const timelineStore = useTimelineStore();
  const mediaStore = useMediaStore();
  const timelineSettingsStore = useTimelineSettingsStore();
  const workspaceStore = useWorkspaceStore();
  const fileManager = useFileManager();
  const timelineMediaUsageStore = useTimelineMediaUsageStore();
  const appClipboard = useAppClipboard();
  const uiStore = useUiStore();
  const toast = useToast();
  const { t } = useI18n();
  const { showPresetModal } = useTimelineTextPreset();

  const dragPreview = ref<DragPreview | null>(null);

  const {
    isActive: isImporting,
    progress: importProgress,
    fileName: importFileName,
    phase: importPhase,
    begin: beginImport,
    end: endImport,
    cancel: cancelImport,
    onProgress: onImportProgress,
  } = useUploadProgress();

  function clearDragPreview() {
    dragPreview.value = null;
  }

  function getCompatibleTrackId(trackId: string, kind: 'video' | 'audio') {
    const track = getTrackById(trackId);
    if (track && track.kind === kind && !track.locked) {
      return trackId;
    }

    const firstCompatible = timelineStore.timelineDoc?.tracks.find(
      (t) => t.kind === kind && !t.locked,
    );
    return firstCompatible?.id ?? null;
  }

  function getTrackById(trackId: string) {
    return timelineStore.timelineDoc?.tracks.find((t) => t.id === trackId);
  }

  // Always return a usable, unlocked track of the given kind. If none exists,
  // auto-create one — mirroring the behavior of MobileAddToTimelineModal. The
  // caller never has to fall back to a possibly invalid `baseTrackId`.
  function ensureDroppableTrackId(params: { baseTrackId: string; kind: 'video' | 'audio' }) {
    const existing = getCompatibleTrackId(params.baseTrackId, params.kind);
    if (existing) return existing;

    const sameKindCount = (timelineStore.timelineDoc?.tracks ?? []).filter(
      (t) => t.kind === params.kind,
    ).length;
    const name =
      params.kind === 'video' ? `Video ${sameKindCount + 1}` : `Audio ${sameKindCount + 1}`;

    const existingIds = new Set((timelineStore.timelineDoc?.tracks ?? []).map((t) => t.id));
    timelineStore.addTrack(params.kind, name);

    // Video tracks are prepended (new on top), audio appended (new at bottom);
    // identify the new track by absence from the pre-add id set, not position.
    const created = (timelineStore.timelineDoc?.tracks ?? []).find(
      (t) => t.kind === params.kind && !existingIds.has(t.id),
    );
    return created?.id ?? null;
  }

  function reportNoDroppableTrack(kind: 'video' | 'audio') {
    toast.add({
      color: 'warning',
      title: t('common.warning'),
      description: t('fastcat.timeline.noDroppableTrack', {
        kind: t(
          kind === 'video' ? 'fastcat.timeline.trackKindVideo' : 'fastcat.timeline.trackKindAudio',
        ),
      }),
    });
  }

  async function getPreviewDurationUsAsync(params: {
    kind: 'file' | 'timeline' | 'adjustment' | 'background' | 'text' | 'shape' | 'hud';
    path?: string;
  }) {
    if (params.kind === 'file' && params.path) {
      const meta = await mediaStore.getOrFetchMetadataByPath(params.path);
      if (meta && !meta.error && meta.duration) return secondsToTicksClamped(meta.duration);

      // For images/text or unknown failures fall back to a static default so the
      // preview ghost is still useful. Real failures will be caught at insert time.
      return workspaceStore.userSettings.timeline.defaultStaticClipDurationTicks;
    }
    if (params.kind === 'timeline' && params.path) {
      const file = await fileManager.vfs.getFile(params.path);
      if (file) {
        try {
          const text = await withFileIoSlot(() => file.text());
          const doc = parseTimelineFromOtio(text, {
            id: 'preview',
            name: getWorkspacePathFileName(params.path),
            format: timelineStore.timelineFormat,
          });
          return selectTimelineDurationTicks(doc);
        } catch {
          return 0;
        }
      }
    }
    return workspaceStore.userSettings.timeline.defaultStaticClipDurationTicks;
  }

  function resolveDropTrackId(params: {
    inputTrackId: string;
    payloadKind: 'file' | 'timeline' | 'adjustment' | 'background' | 'text' | 'shape' | 'hud';
    path?: string;
  }) {
    const { inputTrackId, payloadKind, path } = params;
    const inputTrack = getTrackById(inputTrackId);
    if (!inputTrack) return null;

    if (payloadKind === 'timeline') {
      return inputTrack.locked
        ? getCompatibleTrackId(inputTrackId, inputTrack.kind)
        : inputTrack.id;
    }

    const mediaType = getMediaTypeFromFilename(path ?? '');
    if (mediaType === 'audio') {
      return getCompatibleTrackId(inputTrackId, 'audio');
    }

    return getCompatibleTrackId(inputTrackId, 'video');
  }

  function resolveDropStartTicks(params: {
    trackId: string;
    startTicks: number;
    durationTicks: number;
    pseudo: boolean;
  }) {
    const timelineDoc = timelineStore.timelineDoc;
    if (!timelineDoc) return params.startTicks;

    const snapSettings = workspaceStore.userSettings.timeline.snapping;
    const timelineEndTicks = Number.isFinite(timelineStore.duration)
      ? Math.max(0, Math.round(timelineStore.duration))
      : null;
    const snapTargetsTicks = computeSnapTargetsTicks({
      tracks: timelineDoc.tracks,
      includeTimelineStart: snapSettings.timelineEdges,
      includeTimelineEndTicks: snapSettings.timelineEdges ? timelineEndTicks : null,
      includePlayheadTicks: snapSettings.playhead ? timelineStore.currentTime : null,
      includeMarkers: snapSettings.markers,
      markers: timelineStore.getMarkers(),
      includeClips: snapSettings.clips,
      selectionRangeTicks: snapSettings.selection ? timelineStore.getSelectionRange() : null,
    });
    const snappedStartTicks = computeSnappedStartTicks({
      rawStartTicks: params.startTicks,
      draggingItemDurationTicks: params.durationTicks,
      fps: sanitizeFps(timelineDoc.timebase),
      zoom: timelineStore.timelineZoom,
      snapThresholdPx: timelineSettingsStore.snapThresholdPx,
      snapTargetsTicks,
      enableFrameSnap: (() => {
        const track = getTrackById(params.trackId);
        const isVideo = track?.kind === 'video';
        return isVideo ? true : !timelineSettingsStore.freeAudioPlacement;
      })(),
      enableClipSnap: timelineSettingsStore.toolbarSnapMode === 'snap',
      frameOffsetTicks: 0,
    });

    return snappedStartTicks;
  }

  function isDropPlacementInvalid(params: {
    trackId: string;
    startTicks: number;
    durationTicks: number;
    pseudo: boolean;
  }) {
    if (params.pseudo) return false;

    const track = getTrackById(params.trackId);
    if (!track) return false;

    const isVideo = track.kind === 'video';
    const enableFrameSnap = isVideo ? true : !timelineSettingsStore.freeAudioPlacement;

    const fps = sanitizeFps(timelineStore.timelineDoc?.timebase);
    const startTicks = enableFrameSnap
      ? quantizeTicksToFrames(params.startTicks, fps, 'round')
      : params.startTicks;
    const durationTicks = enableFrameSnap
      ? quantizeTicksToFrames(params.durationTicks, fps, 'round')
      : params.durationTicks;

    try {
      assertNoOverlap(track, '', startTicks, durationTicks);
      return false;
    } catch (err) {
      if (err instanceof Error && err.message === 'Item overlaps with another item') {
        return true;
      }
      throw err;
    }
  }

  function reportInvalidDropPlacement() {
    toast.add({
      color: 'error',
      title: t('fastcat.timeline.cannotInsertPlayheadOnClip'),
      icon: 'i-heroicons-x-circle',
    });
  }

  function resolveVirtualClipName(item: TimelineDropItem) {
    const kind = item.kind ?? 'file';
    return item.name || kind.charAt(0).toUpperCase() + kind.slice(1);
  }

  function resolveShapeType(value?: string): ShapeType {
    if (
      value === 'square' ||
      value === 'circle' ||
      value === 'triangle' ||
      value === 'star' ||
      value === 'cloud' ||
      value === 'speech_bubble' ||
      value === 'bang'
    ) {
      return value;
    }

    return 'square';
  }

  function resolveHudType(value?: string): HudType {
    return value === 'media_frame' ? value : 'media_frame';
  }

  function normalizeDropItems(payload: unknown): TimelineDropItem[] {
    if (Array.isArray((payload as { items?: unknown[] } | null)?.items)) {
      return (payload as { items: TimelineDropItem[] }).items;
    }

    if (Array.isArray(payload)) {
      return payload as TimelineDropItem[];
    }

    if (payload && typeof payload === 'object') {
      return [payload as TimelineDropItem];
    }

    return [];
  }

  async function executeVirtualClipDrop(
    item: TimelineDropItem,
    context: TimelineDropContext,
  ): Promise<TimelineDropResult> {
    const clipType = item.kind;
    if (
      clipType !== 'shape' &&
      clipType !== 'hud' &&
      clipType !== 'adjustment' &&
      clipType !== 'background' &&
      clipType !== 'text'
    ) {
      return {
        nextStartTicks: context.currentStartTicks,
        added: false,
      };
    }

    const targetTrackId = ensureDroppableTrackId({
      baseTrackId: context.baseTrackId,
      kind: 'video',
    });
    if (!targetTrackId) {
      reportNoDroppableTrack('video');
      return { nextStartTicks: context.currentStartTicks, added: false };
    }
    const durationTicks = workspaceStore.userSettings.timeline.defaultStaticClipDurationTicks;
    const nextStartTicks = resolveDropStartTicks({
      trackId: targetTrackId,
      startTicks: context.currentStartTicks,
      durationTicks,
      pseudo: context.pseudo,
    });

    const res = await timelineStore.addVirtualClipToTrack({
      trackId: targetTrackId,
      startTicks: nextStartTicks,
      clipType,
      name: resolveVirtualClipName(item),
      shapeType:
        clipType === 'shape'
          ? (((item.presetParams as Record<string, unknown>)?.shapeType as
              | import('~/timeline/types').ShapeType
              | undefined) ?? resolveShapeType(item.type))
          : undefined,
      fillColor:
        clipType === 'shape'
          ? ((item.presetParams as Record<string, unknown>)?.fillColor as string | undefined)
          : undefined,
      strokeColor:
        clipType === 'shape'
          ? ((item.presetParams as Record<string, unknown>)?.strokeColor as string | undefined)
          : undefined,
      strokeWidth:
        clipType === 'shape'
          ? ((item.presetParams as Record<string, unknown>)?.strokeWidth as number | undefined)
          : undefined,
      shapeConfig:
        clipType === 'shape'
          ? ((item.presetParams as Record<string, unknown>)?.shapeConfig as
              | import('~/timeline/types').ShapeConfig
              | undefined)
          : undefined,
      hudType:
        clipType === 'hud'
          ? (((item.presetParams as Record<string, unknown>)?.hudType as
              | 'media_frame'
              | undefined) ?? resolveHudType(item.type))
          : undefined,
      background:
        clipType === 'hud'
          ? ((item.presetParams as Record<string, unknown>)?.background as
              | import('~/timeline/types').HudMediaParams
              | undefined)
          : undefined,
      content:
        clipType === 'hud'
          ? ((item.presetParams as Record<string, unknown>)?.content as
              | import('~/timeline/types').HudMediaParams
              | undefined)
          : undefined,
      text:
        clipType === 'text'
          ? ((item.presetParams as Record<string, unknown>)?.text as string | undefined)
          : undefined,
      style:
        clipType === 'text'
          ? ((item.presetParams as Record<string, unknown>)?.style as
              | import('~/timeline/types').TextClipStyle
              | undefined)
          : undefined,
      pseudo: context.pseudo,
    });

    return {
      nextStartTicks: nextStartTicks + durationTicks,
      added: true,
      trackId: targetTrackId,
      itemId: Array.isArray(res) ? res[0] : undefined,
    };
  }

  async function executeTimelineClipDrop(
    item: TimelineDropItem,
    context: TimelineDropContext,
  ): Promise<TimelineDropResult> {
    if (!item.path) {
      return {
        nextStartTicks: context.currentStartTicks,
        added: false,
      };
    }

    const baseTrack = getTrackById(context.baseTrackId);
    const targetTrackId = ensureDroppableTrackId({
      baseTrackId: context.baseTrackId,
      kind: baseTrack?.kind ?? 'video',
    });
    if (!targetTrackId) {
      reportNoDroppableTrack(baseTrack?.kind ?? 'video');
      return { nextStartTicks: context.currentStartTicks, added: false };
    }
    const durationTicks = await getPreviewDurationUsAsync({ kind: 'timeline', path: item.path });
    const nextStartTicks = resolveDropStartTicks({
      trackId: targetTrackId,
      startTicks: context.currentStartTicks,
      durationTicks,
      pseudo: context.pseudo,
    });

    const res = await timelineStore.addTimelineClipToTimelineFromPath({
      trackId: targetTrackId,
      name: item.name || 'Timeline',
      path: item.path,
      startTicks: nextStartTicks,
      pseudo: context.pseudo,
    });

    return {
      nextStartTicks: nextStartTicks + (res.durationTicks || 0),
      added: true,
      trackId: targetTrackId,
      itemId: res.itemId,
    };
  }

  async function executeTextFileDrop(
    item: TimelineDropItem,
    context: TimelineDropContext,
  ): Promise<TimelineDropResult> {
    if (!item.path) {
      return {
        nextStartTicks: context.currentStartTicks,
        added: false,
      };
    }

    const targetTrackId = ensureDroppableTrackId({
      baseTrackId: context.baseTrackId,
      kind: 'video',
    });
    if (!targetTrackId) {
      reportNoDroppableTrack('video');
      return { nextStartTicks: context.currentStartTicks, added: false };
    }
    const file = await fileManager.vfs.getFile(item.path);
    if (!file) {
      return {
        nextStartTicks: context.currentStartTicks,
        added: false,
      };
    }

    const durationTicks = workspaceStore.userSettings.timeline.defaultStaticClipDurationTicks;
    const text = await withFileIoSlot(() => file.text());
    const nextStartTicks = resolveDropStartTicks({
      trackId: targetTrackId,
      startTicks: context.currentStartTicks,
      durationTicks,
      pseudo: context.pseudo,
    });

    const res = await timelineStore.addVirtualClipToTrack({
      trackId: targetTrackId,
      startTicks: nextStartTicks,
      clipType: 'text',
      name: item.name || getWorkspacePathFileName(item.path),
      text,
      pseudo: context.pseudo,
    });

    return {
      nextStartTicks: nextStartTicks + durationTicks,
      added: true,
      trackId: targetTrackId,
      itemId: Array.isArray(res) ? res[0] : undefined,
    };
  }

  async function executeMediaFileDrop(
    item: TimelineDropItem,
    context: TimelineDropContext,
  ): Promise<TimelineDropResult> {
    if (!item.path) {
      return {
        nextStartTicks: context.currentStartTicks,
        added: false,
      };
    }

    const mediaKind =
      getMediaTypeFromFilename(item.name || item.path) === 'audio' ? 'audio' : 'video';
    const targetTrackId = ensureDroppableTrackId({
      baseTrackId: context.baseTrackId,
      kind: mediaKind,
    });
    if (!targetTrackId) {
      reportNoDroppableTrack(mediaKind);
      return { nextStartTicks: context.currentStartTicks, added: false };
    }
    const durationTicks = await getPreviewDurationUsAsync({ kind: 'file', path: item.path });
    const nextStartTicks = resolveDropStartTicks({
      trackId: targetTrackId,
      startTicks: context.currentStartTicks,
      durationTicks,
      pseudo: context.pseudo,
    });

    const res = await timelineStore.addClipToTimelineFromPath({
      trackId: targetTrackId,
      name: item.name || getWorkspacePathFileName(item.path),
      path: item.path,
      startTicks: nextStartTicks,
      pseudo: context.pseudo,
    });

    return {
      nextStartTicks: nextStartTicks + (res.durationTicks || 0),
      added: true,
      trackId: targetTrackId,
      itemId: res.itemId,
    };
  }

  const dropStrategies: TimelineDropStrategy[] = [
    {
      canHandle: (item) =>
        item.kind === 'shape' ||
        item.kind === 'hud' ||
        item.kind === 'adjustment' ||
        item.kind === 'background' ||
        (item.kind === 'text' && !item.path),
      execute: executeVirtualClipDrop,
    },
    {
      canHandle: (item) => item.kind === 'timeline',
      execute: executeTimelineClipDrop,
    },
    {
      canHandle: (item) =>
        Boolean(item.path) && getMediaTypeFromFilename(item.name || item.path || '') === 'text',
      execute: executeTextFileDrop,
    },
    {
      canHandle: (item) => Boolean(item.path),
      execute: executeMediaFileDrop,
    },
  ];

  function resolveDropStrategy(item: TimelineDropItem) {
    return dropStrategies.find((strategy) => strategy.canHandle(item)) ?? null;
  }

  function isSupportedExternalFile(file: File): boolean {
    const type = getMediaTypeFromFilename(file.name);
    return type === 'video' || type === 'audio' || type === 'image';
  }

  function isSupportedLibraryItem(item: TimelineDropItem): boolean {
    if (item.kind === 'file' && item.path) {
      const type = getMediaTypeFromFilename(item.name || item.path);
      return type === 'video' || type === 'audio' || type === 'image' || type === 'text';
    }
    return item.kind
      ? ['adjustment', 'background', 'text', 'shape', 'hud', 'timeline'].includes(item.kind)
      : false;
  }

  async function importExternalItemToProject(
    item: TimelineDropItem,
    signal?: AbortSignal,
  ): Promise<TimelineDropItem> {
    if (!item.path) return item;

    if (item.path.startsWith('/remote')) {
      const targetDir = await fileManager.resolveDefaultTargetDir({ name: item.name || item.path });
      if (!targetDir) return item;

      const resultPath = await fileManager.copyEntry({
        source: { path: item.path, name: item.name || '', kind: 'file' },
        targetDirPath: targetDir,
        abortSignal: signal,
      });

      return {
        ...item,
        path:
          ((resultPath as unknown as Record<string, unknown> | undefined)?.newPath as
            | string
            | undefined) || item.path,
        kind: 'file',
      };
    }

    if (!appClipboard.dragSourceVfs) {
      return item;
    }

    const targetDir = await fileManager.resolveDefaultTargetDir({ name: item.name || item.path });
    if (!targetDir) return item;

    const copiedPath = await crossVfsCopy({
      sourceVfs: appClipboard.dragSourceVfs,
      targetVfs: fileManager.vfs,
      sourcePath: item.path,
      sourceKind: 'file',
      targetDirPath: targetDir,
    });

    return {
      ...item,
      path: copiedPath,
      kind: getMediaTypeFromFilename(item.name || copiedPath) === 'timeline' ? 'timeline' : 'file',
      name: item.name || getWorkspacePathFileName(copiedPath),
    };
  }

  async function onTrackDragOver(e: DragEvent, trackId: string) {
    const types = e.dataTransfer?.types;
    if (!types) {
      clearDragPreview();
      return;
    }

    // Only OS file drags remain on HTML5 DragEvent. Internal application drags
    // use the pointer-DnD zone on EditorTimeline.
    if (types.includes('Files')) {
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length > 0 && files.every(isSupportedExternalFile)) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';

        // We can't show a full preview for OS files easily because we don't have metadata yet,
        // but we can show a ghost box with a generic label.
        const dropPositionTicks = getDropPosition(e);
        if (dropPositionTicks !== null) {
          const fileLabel =
            files.length > 1
              ? t('fastcat.timeline.importFilesCount', { count: files.length })
              : (files[0]?.name ?? '');
          const durationTicks = workspaceStore.userSettings.timeline.defaultStaticClipDurationTicks;
          dragPreview.value = {
            trackId,
            startTicks: resolveDropStartTicks({
              trackId,
              startTicks: dropPositionTicks,
              durationTicks,
              pseudo: false,
            }),
            label: fileLabel,
            durationTicks,
            kind: 'file',
          };
          dragPreview.value.invalid = isDropPlacementInvalid({
            trackId,
            startTicks: dragPreview.value.startTicks,
            durationTicks,
            pseudo: false,
          });
        }
        return;
      } else if (files.length > 0) {
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
        clearDragPreview();
        return;
      }
    }

    clearDragPreview();
  }

  function onTrackDragLeave(e: DragEvent, trackId: string) {
    const currentTarget = e.currentTarget as HTMLElement | null;
    const relatedTarget = e.relatedTarget as Node | null;
    if (currentTarget?.contains(relatedTarget)) return;

    if (dragPreview.value?.trackId === trackId) {
      clearDragPreview();
    }
  }

  function getDropPosition(e: DragEvent) {
    if (!scrollEl.value) return null;

    // When dragging over a track, use the track element's bounding rect.
    // The track lives inside TimelineTracks which has a CSS transform
    // (translate3d(-scrollLeft, 0, 0)) applied, so its getBoundingClientRect()
    // already accounts for horizontal scroll. Adding scrollLeft again would
    // double-count it. Additionally, the masterScrollEl (scrollEl) sits
    // flush against the left edge of the panel and doesn't include the
    // 220px track labels offset, causing a constant rightward shift.
    const targetEl = e.currentTarget as HTMLElement | null;
    if (targetEl?.dataset.trackId) {
      const rect = targetEl.getBoundingClientRect();
      const x = e.clientX - rect.left;
      return pxToTimeTicks(x, timelineStore.timelineZoom);
    }

    // Fallback for non-track drop targets
    const rect = scrollEl.value.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollEl.value.scrollLeft;
    return pxToTimeTicks(x, timelineStore.timelineZoom);
  }

  async function handleFileDrop(files: File[], trackId: string, startTicks: number) {
    if (files.length === 0) return;

    const supportedFiles = files.filter(isSupportedExternalFile);
    if (supportedFiles.length === 0) {
      toast.add({
        color: 'warning',
        title: t('common.warning'),
        description: t('fastcat.timeline.noSupportedFiles'),
      });
      return;
    }

    if (dragPreview.value?.trackId === trackId && dragPreview.value.invalid) {
      reportInvalidDropPlacement();
      clearDragPreview();
      return;
    }

    const totalBytes = supportedFiles.reduce((acc, file) => acc + file.size, 0);
    const useBackgroundTask = totalBytes >= LARGE_UPLOAD_BACKGROUND_THRESHOLD_BYTES;

    const fallbackBytes = supportedFiles.reduce((acc, file) => acc + file.size, 0);
    try {
      const abortSignal = beginImport(
        t('videoEditor.fileManager.actions.importing'),
        useBackgroundTask,
      );

      const results = await fileManager.handleFiles(supportedFiles, {
        abortSignal,
        backgroundMode: useBackgroundTask ? 'auto' : 'never',
        onProgress: (p) => onImportProgress(p, fallbackBytes),
        selectInFileManager: false,
      });

      if (abortSignal.aborted) return;
      if (!results) return;

      let currentStartTicks = startTicks;
      for (const res of results) {
        try {
          const result = await executeMediaFileDrop(
            { path: res.targetPath, name: res.fileName },
            { baseTrackId: trackId, currentStartTicks, pseudo: false },
          );
          currentStartTicks = result.nextStartTicks;
        } catch (err) {
          // One file failing (e.g. unsupported codec, broken metadata) must not
          // abort placement of the remaining successfully imported files.
          log.warn('[timeline] Failed to place file on timeline:', res.fileName, err);
          const message = err instanceof Error ? err.message : String(err);
          toast.add({
            color: 'warning',
            title: t('common.warning'),
            description: `${res.fileName}: ${message}`,
          });
        }
      }

      await timelineStore.requestTimelineSave({ immediate: true });
      void timelineMediaUsageStore.refreshUsage();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      log.error('[timeline] File drop import failed', err);
      const message = err instanceof Error ? err.message : String(err);
      toast.add({
        color: 'error',
        title: t('common.error'),
        description: message,
      });
    } finally {
      endImport();
      clearDragPreview();
    }
  }

  async function handleLibraryDrop(
    data: string,
    trackId: string,
    startTicks: number,
    options?: {
      pseudo?: boolean;
      clientX?: number;
      clientY?: number;
      showPresets?: boolean;
    },
  ) {
    try {
      const payload = JSON.parse(data) as { isExternal?: boolean; [key: string]: unknown };
      const items = normalizeDropItems(payload);
      let currentStartTicks = startTicks;
      let addedCount = 0;
      const pseudo = options?.pseudo === true;
      let itemsToDrop = items;

      if (payload.isExternal) {
        const signal = beginImport(t('videoEditor.fileManager.actions.importing'), false);

        const externalItems = items.filter(isSupportedLibraryItem);
        for (let i = 0; i < externalItems.length; i++) {
          if (signal.aborted) break;
          const item = externalItems[i];
          if (!item) continue;
          importFileName.value = item.name || '';
          importProgress.value = i / externalItems.length;
          externalItems[i] = await importExternalItemToProject(item, signal);
        }
        itemsToDrop = externalItems;

        if (signal.aborted) {
          endImport();
          return;
        }

        endImport();
      }

      for (const item of itemsToDrop) {
        const strategy = resolveDropStrategy(item);
        if (!strategy) {
          continue;
        }

        const durationTicks = await getPreviewDurationUsAsync({
          kind: item.kind ?? 'file',
          path: item.path,
        });
        const targetTrackId = resolveDropTrackId({
          inputTrackId: trackId,
          payloadKind: item.kind ?? 'file',
          path: item.path,
        });
        const placementStartTicks = targetTrackId
          ? resolveDropStartTicks({
              trackId: targetTrackId,
              startTicks: currentStartTicks,
              durationTicks,
              pseudo,
            })
          : currentStartTicks;
        if (
          targetTrackId &&
          isDropPlacementInvalid({
            trackId: targetTrackId,
            startTicks: placementStartTicks,
            durationTicks,
            pseudo,
          })
        ) {
          reportInvalidDropPlacement();
          break;
        }

        const result = await strategy.execute(item, {
          baseTrackId: trackId,
          currentStartTicks: placementStartTicks,
          pseudo,
        });

        currentStartTicks = result.nextStartTicks;
        if (result.added) {
          addedCount++;

          if (item.kind === 'text') {
            if (item.isRightClick && result.trackId && result.itemId) {
              uiStore.triggerShowTextPresetMenu({
                trackId: result.trackId,
                itemId: result.itemId,
                x: options?.clientX ?? 0,
                y: options?.clientY ?? 0,
              });
            } else if (options?.showPresets && result.trackId && result.itemId) {
              showPresetModal(result.trackId, result.itemId);
            }
          }
        }
      }

      if (addedCount > 0) {
        await timelineStore.requestTimelineSave({ immediate: true });
        void timelineMediaUsageStore.refreshUsage();
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      log.error('[timeline] JSON drop processing failed', err);
      const message = err instanceof Error ? err.message : String(err);
      toast.add({
        color: 'error',
        title: t('common.error'),
        description: message,
      });
    } finally {
      endImport();
      clearDragPreview();
    }
  }

  async function buildPointerDragPreview(params: {
    payload: unknown;
    trackId: string;
    clientX: number;
    trackRectLeft: number;
    pointer: Pick<DragEvent, 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey'>;
  }) {
    const items = normalizeDropItems(params.payload);
    const firstItem = items[0];
    if (!firstItem || !isSupportedLibraryItem(firstItem)) {
      clearDragPreview();
      return null;
    }

    const targetTrackId = resolveDropTrackId({
      inputTrackId: params.trackId,
      payloadKind: firstItem.kind ?? 'file',
      path: firstItem.path,
    });
    if (!targetTrackId) {
      clearDragPreview();
      return null;
    }

    const durationTicks = await getPreviewDurationUsAsync({
      kind: firstItem.kind ?? 'file',
      path: firstItem.path,
    });
    const rawStartTicks = pxToTimeTicks(
      params.clientX - params.trackRectLeft,
      timelineStore.timelineZoom,
    );
    const pseudo =
      isLayer1Pressed(params.pointer as DragEvent, workspaceStore.userSettings) ||
      timelineSettingsStore.isPseudoOverlapEnabled;
    const startTicks = resolveDropStartTicks({
      trackId: targetTrackId,
      startTicks: rawStartTicks,
      durationTicks,
      pseudo,
    });
    const label =
      items.length > 1
        ? `${firstItem.name || firstItem.kind || 'Item'} +${items.length - 1}`
        : firstItem.name || firstItem.kind || 'Item';

    const preview = {
      trackId: targetTrackId,
      startTicks,
      label,
      durationTicks,
      kind: firstItem.kind === 'timeline' ? ('timeline-clip' as const) : ('file' as const),
      invalid: isDropPlacementInvalid({
        trackId: targetTrackId,
        startTicks,
        durationTicks,
        pseudo,
      }),
    };
    dragPreview.value = preview;
    return preview;
  }

  return {
    dragPreview,
    clearDragPreview,
    getDropPosition,
    buildPointerDragPreview,
    onTrackDragOver,
    onTrackDragLeave,
    handleFileDrop,
    handleLibraryDrop,
    isImporting,
    importProgress,
    importFileName,
    importPhase,
    cancelImport,
  };
}
