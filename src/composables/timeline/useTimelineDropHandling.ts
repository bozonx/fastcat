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
  presetParams?: Record<string, any>;
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
  const uiStore = useUiStore();
  const toast = useToast();
  const { t } = useI18n();
  const { showPresetModal } = useTimelineTextPreset();

  const dragPreview = ref<DragPreview | null>(null);

  // Import/Copy progress state
  const isImporting = ref(false);
  const importProgress = ref(0);
  const importFileName = ref('');
  const importPhase = ref('');
  let importAbortController: AbortController | null = null;

  function clearDragPreview() {
    dragPreview.value = null;
  }

  function getCompatibleTrackId(trackId: string, kind: 'video' | 'audio') {
    const track = getTrackById(trackId);
    if (track && track.kind === kind) {
      return trackId;
    }

    const firstCompatible = timelineStore.timelineDoc?.tracks.find((t) => t.kind === kind);
    return firstCompatible?.id ?? null;
  }

  function getTrackById(trackId: string) {
    return timelineStore.timelineDoc?.tracks.find((t) => t.id === trackId);
  }

  async function getPreviewDurationUsAsync(params: {
    kind: 'file' | 'timeline' | 'adjustment' | 'background' | 'text' | 'shape' | 'hud';
    path?: string;
  }) {
    if (params.kind === 'file' && params.path) {
      const meta = await mediaStore.getOrFetchMetadataByPath(params.path);
      if (meta?.duration) return Math.floor(meta.duration * 1_000_000);

      const type = getMediaTypeFromFilename(params.path);
      if (type === 'video' || type === 'audio') {
        // If meta is null or has 0 duration, it might be still loading or failed.
        // We try one more time or just use a larger fallback if it's clearly a media file.
        // Actually, let's just return the default if it really failed,
        // but getOrFetchMetadataByPath should have awaited the extraction.
      }

      return workspaceStore.userSettings.timeline.defaultStaticClipDurationUs;
    }
    if (params.kind === 'timeline' && params.path) {
      const file = await fileManager.vfs.getFile(params.path);
      if (file) {
        try {
          const doc = JSON.parse(await file.text());
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
      return inputTrack.id;
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
    const { trackId, startUs, durationUs, pseudo } = params;
    const track = getTrackById(trackId);
    if (!track) return startUs;
    if (pseudo) return startUs;

    let nextStartUs = Math.max(0, Math.round(startUs));

    for (const item of track.items) {
      if (item.kind !== 'clip') continue;

      const itemStartUs = item.timelineRange.startUs;
      const itemEndUs = itemStartUs + item.timelineRange.durationUs;
      const nextEndUs = nextStartUs + durationUs;

      if (nextEndUs <= itemStartUs || nextStartUs >= itemEndUs) {
        continue;
      }

      nextStartUs = itemEndUs;
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

    const targetTrackId = getCompatibleTrackId(context.baseTrackId, 'video') ?? context.baseTrackId;
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
          ? (item.presetParams?.shapeType ?? resolveShapeType(item.type))
          : undefined,
      fillColor: clipType === 'shape' ? item.presetParams?.fillColor : undefined,
      strokeColor: clipType === 'shape' ? item.presetParams?.strokeColor : undefined,
      strokeWidth: clipType === 'shape' ? item.presetParams?.strokeWidth : undefined,
      shapeConfig: clipType === 'shape' ? item.presetParams?.shapeConfig : undefined,
      hudType:
        clipType === 'hud' ? (item.presetParams?.hudType ?? resolveHudType(item.type)) : undefined,
      background: clipType === 'hud' ? item.presetParams?.background : undefined,
      content: clipType === 'hud' ? item.presetParams?.content : undefined,
      text: clipType === 'text' ? item.presetParams?.text : undefined,
      style: clipType === 'text' ? item.presetParams?.style : undefined,
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

    const targetTrackId =
      resolveDropTrackId({
        inputTrackId: context.baseTrackId,
        payloadKind: 'timeline',
        path: item.path,
      }) ?? context.baseTrackId;
    const durationUs = await getPreviewDurationUsAsync({ kind: 'timeline', path: item.path });
    const nextStartUs = resolveInsertStartUs({
      trackId: targetTrackId,
      startUs: context.currentStartUs,
      durationUs,
      pseudo: context.pseudo,
    });

    const res = await (timelineStore as any).addTimelineClipToTimelineFromPath({
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
      itemId: (res as any).itemId,
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

    const targetTrackId = getCompatibleTrackId(context.baseTrackId, 'video') ?? context.baseTrackId;
    const file = await fileManager.vfs.getFile(item.path);
    if (!file) {
      return {
        nextStartUs: context.currentStartUs,
        added: false,
      };
    }

    const durationUs = workspaceStore.userSettings.timeline.defaultStaticClipDurationUs;
    const text = await file.text();
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

    const targetTrackId =
      resolveDropTrackId({
        inputTrackId: context.baseTrackId,
        payloadKind: 'file',
        path: item.path,
      }) ?? context.baseTrackId;
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
      itemId: (res as any).itemId,
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

    if (!draggedFile.draggedFile.value) {
      clearDragPreview();
      return null;
    }

    const pseudo =
      isLayer1Pressed(e, workspaceStore.userSettings) ||
      timelineSettingsStore.overlapMode === 'pseudo';
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

  function isSupportedLibraryItem(item: any): boolean {
    if (item.kind === 'file' && item.path) {
      const type = getMediaTypeFromFilename(item.name || item.path);
      return type === 'video' || type === 'audio' || type === 'image';
    }
    return ['adjustment', 'background', 'text', 'shape', 'hud', 'timeline'].includes(item.kind);
  }

  async function onTrackDragOver(e: DragEvent, trackId: string) {
    const types = e.dataTransfer?.types;
    if (!types) {
      clearDragPreview();
      return;
    }

    // Handle OS files
    if (types.includes('Files')) {
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length > 0 && files.every(isSupportedExternalFile)) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        
        // We can't show a full preview for OS files easily because we don't have metadata yet,
        // but we can show a ghost box with a generic label.
        const dropPositionUs = getDropPosition(e);
        if (dropPositionUs !== null) {
          dragPreview.value = {
            trackId,
            startUs: dropPositionUs,
            label: files.length > 1 ? t('fastcat.timeline.importFilesCount', { count: files.length }) : files[0].name,
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

    const payload = draggedFile.draggedFile.value;
    if (payload?.isExternal) {
      // Check if it's a supported external item (e.g. from BloggerDog)
      if (payload.path && isSupportedLibraryItem(payload)) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';

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
    const rect = scrollEl.value.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollEl.value.scrollLeft;
    return pxToTimeUs(x, timelineStore.timelineZoom);
  }

  async function handleFileDrop(files: File[], trackId: string, startUs: number) {
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

    try {
      isImporting.value = true;
      importProgress.value = 0;
      importPhase.value = t('videoEditor.fileManager.actions.importing');
      importAbortController = new AbortController();

      const results = await fileManager.handleFiles(supportedFiles, {
        abortSignal: importAbortController.signal,
        onProgress: (p) => {
          importProgress.value = p.currentFileIndex / p.totalFiles;
          importFileName.value = p.fileName;
        },
      });

      if (importAbortController.signal.aborted) return;

      let currentStartUs = startUs;
      for (const res of results) {
        const result = await executeMediaFileDrop(
          { path: res.targetPath, name: res.fileName },
          { baseTrackId: trackId, currentStartUs, pseudo: false },
        );
        currentStartUs = result.nextStartUs;
      }

      await timelineStore.requestTimelineSave({ immediate: true });
      void timelineMediaUsageStore.refreshUsage();
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      toast.add({
        color: 'error',
        title: t('common.error'),
        description: err.message,
      });
    } finally {
      isImporting.value = false;
      importAbortController = null;
      clearDragPreview();
    }
  }

  function cancelImport() {
    importAbortController?.abort();
    isImporting.value = false;
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
      const payload = JSON.parse(data) as any;
      const items = normalizeDropItems(payload);
      let currentStartUs = startUs;
      let addedCount = 0;
      const pseudo = options?.pseudo === true;

      // Handle external (BloggerDog or explicit external mark) import
      if (payload?.isExternal) {
        isImporting.value = true;
        importProgress.value = 0;
        importPhase.value = t('videoEditor.fileManager.actions.downloading');
        importAbortController = new AbortController();

        const externalItems = items.filter(isSupportedLibraryItem);
        for (let i = 0; i < externalItems.length; i++) {
          if (importAbortController.signal.aborted) break;
          const item = externalItems[i];
          importFileName.value = item.name || '';
          importProgress.value = i / externalItems.length;

          if (item.path?.startsWith('/remote')) {
            // It's a BloggerDog file, need to copy to local project
            const targetDir = await fileManager.resolveDefaultTargetDir({ name: item.name || item.path });
            const resultPath = await fileManager.copyEntry({
              source: { path: item.path, name: item.name || '', kind: 'file' } as any,
              targetDirPath: targetDir || 'files',
              abortSignal: importAbortController.signal,
            });

            // Re-assign path to the new local path
            item.path = (resultPath as any).newPath || resultPath;
          }
        }

        if (importAbortController.signal.aborted) {
          isImporting.value = false;
          return;
        }

        isImporting.value = false;
      }

      for (const item of items) {
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
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      toast.add({
        color: 'error',
        title: t('common.error'),
        description: String(err?.message ?? err),
      });
    } finally {
      isImporting.value = false;
      importAbortController = null;
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
