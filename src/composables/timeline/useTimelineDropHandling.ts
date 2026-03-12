import { ref, type Ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useMediaStore } from '~/stores/media.store';
import { useTimelineSettingsStore } from '~/stores/timelineSettings.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import { useDraggedFile } from '~/composables/useDraggedFile';
import { pxToTimeUs } from '~/utils/timeline/geometry';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import { getWorkspacePathFileName } from '~/utils/workspace-common';
import { pressedKeyCodes } from '~/utils/hotkeys/pressedKeys';

export interface UseTimelineDropHandlingOptions {
  scrollEl: Ref<HTMLElement | null>;
}

export function useTimelineDropHandling({ scrollEl }: UseTimelineDropHandlingOptions) {
  const timelineStore = useTimelineStore();
  const mediaStore = useMediaStore();
  const timelineSettingsStore = useTimelineSettingsStore();
  const workspaceStore = useWorkspaceStore();
  const timelineMediaUsageStore = useTimelineMediaUsageStore();
  const fileManager = useFileManager();
  const { draggedFile } = useDraggedFile();
  const { t } = useI18n();
  const toast = useToast();

  const dragPreview = ref<{
    trackId: string;
    startUs: number;
    label: string;
    durationUs: number;
    kind: 'timeline-clip' | 'file';
  } | null>(null);

  function isLayer1Pressed(e: DragEvent) {
    const layer1 = workspaceStore.userSettings.hotkeys.layer1 ?? 'Shift';

    if (layer1 === 'Shift') return e.shiftKey;
    if (layer1 === 'Control') return e.ctrlKey;
    if (layer1 === 'Alt') return e.altKey;
    if (layer1 === 'Meta') return e.metaKey;

    return pressedKeyCodes.has(layer1);
  }

  function clearDragPreview() {
    dragPreview.value = null;
  }

  function getTrackById(trackId: string) {
    return timelineStore.timelineDoc?.tracks.find((track) => track.id === trackId) ?? null;
  }

  function getCompatibleTrackId(trackId: string, kind: 'video' | 'audio') {
    const directTrack = getTrackById(trackId);
    if (directTrack?.kind === kind) return directTrack.id;

    return timelineStore.timelineDoc?.tracks.find((track) => track.kind === kind)?.id ?? null;
  }

  function getPreviewDurationUs(params: { path?: string; kind: 'file' | 'timeline' }) {
    if (params.kind === 'timeline') {
      return 2_000_000;
    }

    const path = params.path;
    if (!path) return 5_000_000;

    const metadata = mediaStore.mediaMetadata[path];
    if (metadata?.duration && Number.isFinite(metadata.duration) && metadata.duration > 0) {
      return Math.max(1, Math.round(metadata.duration * 1_000_000));
    }

    const mediaType = getMediaTypeFromFilename(path);
    if (mediaType === 'image' || mediaType === 'text') return 5_000_000;

    return 2_000_000;
  }

  function resolveDropTrackId(params: {
    inputTrackId: string;
    payloadKind: 'file' | 'timeline';
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

  async function buildDragPreview(e: DragEvent, trackId: string) {
    const payload = draggedFile.value;
    if (!payload) {
      clearDragPreview();
      return null;
    }

    const targetTrackId = resolveDropTrackId({
      inputTrackId: trackId,
      payloadKind: payload.kind === 'timeline' ? 'timeline' : 'file',
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

    const durationUs = getPreviewDurationUs({
      kind: payload.kind === 'timeline' ? 'timeline' : 'file',
      path: payload.path,
    });
    const pseudo = isLayer1Pressed(e) || timelineSettingsStore.overlapMode === 'pseudo';
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
  }

  async function onTrackDragOver(e: DragEvent, trackId: string) {
    const types = e.dataTransfer?.types;
    if (!types) {
      clearDragPreview();
      return;
    }

    if (
      !types.includes('application/json') &&
      !types.includes('gran-item') &&
      !types.includes('Files')
    ) {
      clearDragPreview();
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

    try {
      // Use handleFiles from fileManager but that uploads only.
      await fileManager.handleFiles(files);

      // We don't have the final paths here easily.
      // The old handleFileDrop implementation in Timeline.vue was more complex.
      // For now, let's just trigger a legacy refresh or hope the user drag-drops from the project browser instead of OS.
      void timelineMediaUsageStore.refreshUsage();
    } catch (err: any) {
      toast.add({
        color: 'red',
        title: t('common.error'),
        description: err.message,
      });
    }
  }

  async function handleLibraryDrop(
    data: string,
    trackId: string,
    startUs: number,
    options?: { pseudo?: boolean },
  ) {
    try {
      const payload = JSON.parse(data);
      const items = Array.isArray(payload?.items)
        ? payload.items
        : Array.isArray(payload)
          ? payload
          : [payload];
      let currentStartUs = startUs;
      let addedCount = 0;
      const pseudo = options?.pseudo === true;

      for (const item of items) {
        const { kind, name, path } = item;
        let targetTrackId = trackId;

        if (kind === 'shape' || kind === 'hud') {
          targetTrackId = getCompatibleTrackId(trackId, 'video') ?? trackId;
          const nextStartUs = resolveInsertStartUs({
            trackId: targetTrackId,
            startUs: currentStartUs,
            durationUs: 5_000_000,
            pseudo,
          });

          await timelineStore.addVirtualClipToTrack({
            trackId: targetTrackId,
            startUs: nextStartUs,
            clipType: kind,
            name: name || (kind === 'shape' ? 'Shape' : 'HUD'),
            shapeType: kind === 'shape' ? item.type || 'square' : undefined,
            hudType: kind === 'hud' ? item.type || 'media_frame' : undefined,
          });
          currentStartUs = nextStartUs + 5_000_000;
          addedCount++;
        } else if (kind === 'timeline') {
          targetTrackId =
            resolveDropTrackId({ inputTrackId: trackId, payloadKind: 'timeline', path }) ?? trackId;
          const previewDurationUs = getPreviewDurationUs({ kind: 'timeline', path });
          const nextStartUs = resolveInsertStartUs({
            trackId: targetTrackId,
            startUs: currentStartUs,
            durationUs: previewDurationUs,
            pseudo,
          });

          const res = await (timelineStore as any).addTimelineClipToTimelineFromPath({
            trackId: targetTrackId,
            name: name || 'Timeline',
            path: path!,
            startUs: nextStartUs,
          });
          currentStartUs = nextStartUs + res.durationUs;
          addedCount++;
        } else {
          const mediaType = getMediaTypeFromFilename(name || path || '');
          if (mediaType === 'text' && path) {
            targetTrackId = getCompatibleTrackId(trackId, 'video') ?? trackId;
            const file = await fileManager.vfs.getFile(path);
            if (file) {
              const text = await file.text();
              const nextStartUs = resolveInsertStartUs({
                trackId: targetTrackId,
                startUs: currentStartUs,
                durationUs: 5_000_000,
                pseudo,
              });

              await timelineStore.addVirtualClipToTrack({
                trackId: targetTrackId,
                startUs: nextStartUs,
                clipType: 'text',
                name,
                text,
              });
              currentStartUs = nextStartUs + 5_000_000;
              addedCount++;
            }
          } else if (path) {
            targetTrackId =
              resolveDropTrackId({ inputTrackId: trackId, payloadKind: 'file', path }) ?? trackId;
            const previewDurationUs = getPreviewDurationUs({ kind: 'file', path });
            const nextStartUs = resolveInsertStartUs({
              trackId: targetTrackId,
              startUs: currentStartUs,
              durationUs: previewDurationUs,
              pseudo,
            });

            const res = await timelineStore.addClipToTimelineFromPath({
              trackId: targetTrackId,
              name: name || getWorkspacePathFileName(path),
              path,
              startUs: nextStartUs,
            });
            currentStartUs = nextStartUs + res.durationUs;
            addedCount++;
          }
        }
      }

      if (addedCount > 0) {
        await timelineStore.requestTimelineSave({ immediate: true });
        toast.add({
          color: 'green',
          title: t('granVideoEditor.timeline.clipAdded'),
          description:
            addedCount === 1
              ? t('granVideoEditor.timeline.oneClipAdded')
              : t('granVideoEditor.timeline.multipleClipsAdded', { count: addedCount }),
        });
        void timelineMediaUsageStore.refreshUsage();
      }
    } catch (err: any) {
      toast.add({
        color: 'red',
        title: t('common.error'),
        description: String(err?.message ?? err),
      });
    }
    clearDragPreview();
  }

  return {
    dragPreview,
    clearDragPreview,
    getDropPosition,
    onTrackDragOver,
    onTrackDragLeave,
    handleFileDrop,
    handleLibraryDrop,
  };
}
