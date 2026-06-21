import { createDevLogger } from '~/utils/dev-logger';
import { ref, type Ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useMediaStore } from '~/stores/media.store';
import { useTimelineSettingsStore } from '~/stores/timeline-settings.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { useDraggedFile } from '~/composables/useDraggedFile';
import { pxToTimeUs } from '~/utils/timeline/geometry';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import { getWorkspacePathFileName } from '~/utils/workspace-common';
import { isLayer1Pressed } from '~/utils/hotkeys/layerUtils';
import type { HudType, ShapeType } from '~/timeline/types';
import { useThrottleFn } from '@vueuse/core';
import { selectTimelineDurationUs } from '~/timeline/selectors';
import { useUiStore } from '~/stores/ui.store';
import { useTimelineTextPreset } from './useTimelineTextPreset';
import { useAppClipboard } from '~/composables/useAppClipboard';
import { crossVfsCopy } from '~/file-manager/core/vfs/crossVfs';
import { LARGE_UPLOAD_BACKGROUND_THRESHOLD_BYTES } from '~/file-manager/application/fileManagerCommands';
import { parseTimelineFromOtio } from '~/timeline/otio-serializer';
import { quantizeTimeUsToFrames, sanitizeFps } from '~/timeline/commands/utils';
import { secondsToUs } from '~/utils/time';
import { syncFileManagerDragCursor } from '~/composables/file-manager/dragCursor';
import { withFileIoSlot } from '~/utils/io/io-governor';
import { useUploadProgress } from '~/composables/useUploadProgress';
import { hasInternalFileManagerDragType } from '~/composables/file-manager/dragOperation';
const log = createDevLogger('useTimelineDropHandling');

export interface UseTimelineDropHandlingOptions {
  scrollEl: Ref<HTMLElement | null>;
}

interface DragPreview {
  trackId: string;
  startUs: number;
  label: string;
  durationUs: number;
  kind: 'timeline-clip' | 'file';
}

interface TimelineDropItem {
  kind?: 'file' | 'timeline' | 'adjustment' | 'background' | 'text' | 'shape' | 'hud';
  name?: string;
  path?: string;
  type?: string;
  presetParams?: Record<string, unknown>;
  isRightClick?: boolean;
}

interface TimelineDropContext {
  baseTrackId: string;
  currentStartUs: number;
  pseudo: boolean;
}

interface TimelineDropResult {
  nextStartUs: number;
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
  const draggedFile = useDraggedFile();
  const appClipboard = useAppClipboard();
  const uiStore = useUiStore();
  const toast = useToast();
  const { t } = useI18n();
  const { showPresetModal } = useTimelineTextPreset();

  const dragPreview = ref<DragPreview | null>(null);

  // Monotonic token bumped on every clear. The drag preview build is throttled
  // and async (it awaits clip metadata), so a build that started before a drop /
  // drag-end / drag-leave could otherwise resolve afterwards and re-set the
  // ghost, leaving a phantom clip on the timeline. Each build captures the token
  // at start and bails if it changed.
  let previewBuildToken = 0;

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
    previewBuildToken++;
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
      if (meta && !meta.error && meta.duration) return secondsToUs(meta.duration);

      // For images/text or unknown failures fall back to a static default so the
      // preview ghost is still useful. Real failures will be caught at insert time.
      return workspaceStore.userSettings.timeline.defaultStaticClipDurationUs;
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
          return selectTimelineDurationUs(doc);
        } catch {
          return 0;
        }
      }
    }
    return workspaceStore.userSettings.timeline.defaultStaticClipDurationUs;
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

  function resolveInsertStartUs(params: {
    trackId: string;
    startUs: number;
    durationUs: number;
    pseudo: boolean;
  }) {
    const { trackId, pseudo } = params;
    const track = getTrackById(trackId);
    if (!track) return params.startUs;
    if (pseudo) return params.startUs;

    // Quantize to the same frame grid as `addClipToTrack` to prevent post-quantize
    // overlap with neighbour clips on non-integer fps.
    const fps = sanitizeFps(timelineStore.timelineDoc?.timebase.fps);
    let nextStartUs = quantizeTimeUsToFrames(Math.max(0, params.startUs), fps, 'round');
    const durationUs = quantizeTimeUsToFrames(Math.max(0, params.durationUs), fps, 'round');

    for (const item of track.items) {
      if (item.kind !== 'clip') continue;

      const itemStartUs = item.timelineRange.startUs;
      const itemEndUs = itemStartUs + item.timelineRange.durationUs;
      const nextEndUs = nextStartUs + durationUs;

      if (nextEndUs <= itemStartUs || nextStartUs >= itemEndUs) {
        continue;
      }

      nextStartUs = quantizeTimeUsToFrames(itemEndUs, fps, 'ceil');
    }

    return nextStartUs;
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
        nextStartUs: context.currentStartUs,
        added: false,
      };
    }

    const targetTrackId = ensureDroppableTrackId({
      baseTrackId: context.baseTrackId,
      kind: 'video',
    });
    if (!targetTrackId) {
      reportNoDroppableTrack('video');
      return { nextStartUs: context.currentStartUs, added: false };
    }
    const durationUs = workspaceStore.userSettings.timeline.defaultStaticClipDurationUs;
    const nextStartUs = resolveInsertStartUs({
      trackId: targetTrackId,
      startUs: context.currentStartUs,
      durationUs,
      pseudo: context.pseudo,
    });

    const res = await timelineStore.addVirtualClipToTrack({
      trackId: targetTrackId,
      startUs: nextStartUs,
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
      nextStartUs: nextStartUs + durationUs,
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
        nextStartUs: context.currentStartUs,
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
      return { nextStartUs: context.currentStartUs, added: false };
    }
    const durationUs = await getPreviewDurationUsAsync({ kind: 'timeline', path: item.path });
    const nextStartUs = resolveInsertStartUs({
      trackId: targetTrackId,
      startUs: context.currentStartUs,
      durationUs,
      pseudo: context.pseudo,
    });

    const res = await timelineStore.addTimelineClipToTimelineFromPath({
      trackId: targetTrackId,
      name: item.name || 'Timeline',
      path: item.path,
      startUs: nextStartUs,
      pseudo: context.pseudo,
    });

    return {
      nextStartUs: nextStartUs + (res.durationUs || 0),
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
        nextStartUs: context.currentStartUs,
        added: false,
      };
    }

    const targetTrackId = ensureDroppableTrackId({
      baseTrackId: context.baseTrackId,
      kind: 'video',
    });
    if (!targetTrackId) {
      reportNoDroppableTrack('video');
      return { nextStartUs: context.currentStartUs, added: false };
    }
    const file = await fileManager.vfs.getFile(item.path);
    if (!file) {
      return {
        nextStartUs: context.currentStartUs,
        added: false,
      };
    }

    const durationUs = workspaceStore.userSettings.timeline.defaultStaticClipDurationUs;
    const text = await withFileIoSlot(() => file.text());
    const nextStartUs = resolveInsertStartUs({
      trackId: targetTrackId,
      startUs: context.currentStartUs,
      durationUs,
      pseudo: context.pseudo,
    });

    const res = await timelineStore.addVirtualClipToTrack({
      trackId: targetTrackId,
      startUs: nextStartUs,
      clipType: 'text',
      name: item.name || getWorkspacePathFileName(item.path),
      text,
      pseudo: context.pseudo,
    });

    return {
      nextStartUs: nextStartUs + durationUs,
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
        nextStartUs: context.currentStartUs,
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
      return { nextStartUs: context.currentStartUs, added: false };
    }
    const durationUs = await getPreviewDurationUsAsync({ kind: 'file', path: item.path });
    const nextStartUs = resolveInsertStartUs({
      trackId: targetTrackId,
      startUs: context.currentStartUs,
      durationUs,
      pseudo: context.pseudo,
    });

    const res = await timelineStore.addClipToTimelineFromPath({
      trackId: targetTrackId,
      name: item.name || getWorkspacePathFileName(item.path),
      path: item.path,
      startUs: nextStartUs,
      pseudo: context.pseudo,
    });

    return {
      nextStartUs: nextStartUs + (res.durationUs || 0),
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

  const buildDragPreview = useThrottleFn(async (e: DragEvent, trackId: string) => {
    const buildToken = previewBuildToken;
    const payload = draggedFile.draggedFile.value;
    if (!payload || payload.isExternal) {
      clearDragPreview();
      return null;
    }

    const targetTrackId = resolveDropTrackId({
      inputTrackId: trackId,
      payloadKind: payload.kind,
      path: payload.path,
    });

    if (!targetTrackId) {
      clearDragPreview();
      return null;
    }

    const dropPositionUs = getDropPosition(e);
    if (dropPositionUs === null) {
      clearDragPreview();
      return null;
    }

    const durationUs = await getPreviewDurationUsAsync({
      kind: payload.kind,
      path: payload.path,
    });

    // After awaiting metadata fetch, the user may have dropped, cancelled the
    // drag, or replaced the payload. Re-validate everything we relied on. If a
    // drop / drag-end / drag-leave cleared the preview while we awaited, the
    // token changed — bail without resurrecting the ghost.
    if (buildToken !== previewBuildToken) {
      return null;
    }
    const currentPayload = draggedFile.draggedFile.value;
    if (
      !currentPayload ||
      currentPayload.path !== payload.path ||
      currentPayload.kind !== payload.kind
    ) {
      clearDragPreview();
      return null;
    }
    if (!getTrackById(targetTrackId)) {
      clearDragPreview();
      return null;
    }

    const pseudo =
      isLayer1Pressed(e, workspaceStore.userSettings) ||
      timelineSettingsStore.isPseudoOverlapEnabled;
    const startUs = resolveInsertStartUs({
      trackId: targetTrackId,
      startUs: dropPositionUs,
      durationUs,
      pseudo,
    });

    const preview = {
      trackId: targetTrackId,
      startUs,
      label:
        payload.count && payload.count > 1 ? `${payload.name} +${payload.count - 1}` : payload.name,
      durationUs,
      kind: payload.kind === 'timeline' ? ('timeline-clip' as const) : ('file' as const),
    };

    dragPreview.value = preview;
    return preview;
  }, 16);

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

    const payload = draggedFile.draggedFile.value;
    const hasInternalDrag = hasInternalFileManagerDragType(types);

    if (payload && !payload.isExternal) {
      e.preventDefault?.();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      syncFileManagerDragCursor({ isDragging: true, operation: 'timeline-add' });
      await buildDragPreview(e, trackId);
      return;
    }

    if (hasInternalDrag) {
      clearDragPreview();
      return;
    }

    // Handle OS files
    if (types.includes('Files')) {
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length > 0 && files.every(isSupportedExternalFile)) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        syncFileManagerDragCursor({ isDragging: true, operation: 'timeline-add' });

        // We can't show a full preview for OS files easily because we don't have metadata yet,
        // but we can show a ghost box with a generic label.
        const dropPositionUs = getDropPosition(e);
        if (dropPositionUs !== null) {
          const fileLabel =
            files.length > 1
              ? t('fastcat.timeline.importFilesCount', { count: files.length })
              : (files[0]?.name ?? '');
          dragPreview.value = {
            trackId,
            startUs: dropPositionUs,
            label: fileLabel,
            durationUs: workspaceStore.userSettings.timeline.defaultStaticClipDurationUs,
            kind: 'file',
          };
        }
        return;
      } else if (files.length > 0) {
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
        clearDragPreview();
        return;
      }
    }

    if (!types.includes('application/json') && !types.includes('fastcat-item')) {
      clearDragPreview();
      return;
    }

    if (payload?.isExternal) {
      const payloadType = getMediaTypeFromFilename(payload.name || payload.path || '');
      const canImportToTimeline =
        payload.path &&
        payloadType !== 'timeline' &&
        isSupportedLibraryItem({ ...payload, kind: 'file' });

      if (canImportToTimeline) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        syncFileManagerDragCursor({ isDragging: true, operation: 'timeline-add' });

        const dropPositionUs = getDropPosition(e);
        if (dropPositionUs !== null) {
          dragPreview.value = {
            trackId,
            startUs: dropPositionUs,
            label: payload.name,
            durationUs: workspaceStore.userSettings.timeline.defaultStaticClipDurationUs,
            kind: 'file',
          };
        }
      } else {
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
        clearDragPreview();
      }
      return;
    }

    await buildDragPreview(e, trackId);
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
      return pxToTimeUs(x, timelineStore.timelineZoom);
    }

    // Fallback for non-track drop targets
    const rect = scrollEl.value.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollEl.value.scrollLeft;
    return pxToTimeUs(x, timelineStore.timelineZoom);
  }

  async function handleFileDrop(files: File[], trackId: string, startUs: number) {
    const payload = draggedFile.draggedFile.value;
    if (payload?.path) {
      await handleLibraryDrop(JSON.stringify(payload), trackId, startUs);
      return;
    }

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

      let currentStartUs = startUs;
      for (const res of results) {
        try {
          const result = await executeMediaFileDrop(
            { path: res.targetPath, name: res.fileName },
            { baseTrackId: trackId, currentStartUs, pseudo: false },
          );
          currentStartUs = result.nextStartUs;
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
    startUs: number,
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
      let currentStartUs = startUs;
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

        const result = await strategy.execute(item, {
          baseTrackId: trackId,
          currentStartUs,
          pseudo,
        });

        currentStartUs = result.nextStartUs;
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

  return {
    dragPreview,
    clearDragPreview,
    getDropPosition,
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
