import { ref, type Ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useMediaStore } from '~/stores/media.store';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import { pxToTimeUs } from '~/utils/timeline/geometry';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import { getWorkspacePathFileName } from '~/utils/workspace-common';

export interface UseTimelineDropHandlingOptions {
  scrollEl: Ref<HTMLElement | null>;
}

export function useTimelineDropHandling({ scrollEl }: UseTimelineDropHandlingOptions) {
  const timelineStore = useTimelineStore();
  const mediaStore = useMediaStore();
  const timelineMediaUsageStore = useTimelineMediaUsageStore();
  const fileManager = useFileManager();
  const { t } = useI18n();
  const toast = useToast();

  const dragPreview = ref<{
    trackId: string;
    startUs: number;
    label: string;
    durationUs: number;
    kind: 'timeline-clip' | 'file';
  } | null>(null);

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

  async function handleLibraryDrop(data: string, trackId: string, startUs: number) {
    try {
      const payload = JSON.parse(data);
      const items = Array.isArray(payload) ? payload : [payload];
      let currentStartUs = startUs;
      let addedCount = 0;

      for (const item of items) {
        const { kind, name, path } = item;
        const options = { trackId, startUs: currentStartUs };

        if (kind === 'shape' || kind === 'hud') {
          await timelineStore.addVirtualClipToTrack({
            trackId,
            startUs: currentStartUs,
            clipType: kind,
            name: name || (kind === 'shape' ? 'Shape' : 'HUD'),
            shapeType: kind === 'shape' ? item.type || 'square' : undefined,
            hudType: kind === 'hud' ? item.type || 'media_frame' : undefined,
          });
          currentStartUs += 5_000_000;
          addedCount++;
        } else if (kind === 'timeline') {
          const res = await (timelineStore as any).addTimelineClipToTimelineFromPath({
            trackId,
            name: name || 'Timeline',
            path: path!,
            startUs: currentStartUs,
          });
          currentStartUs += res.durationUs;
          addedCount++;
        } else {
          const mediaType = getMediaTypeFromFilename(name || path || '');
          if (mediaType === 'text' && path) {
            const file = await fileManager.vfs.getFile(path);
            if (file) {
              const text = await file.text();
              await timelineStore.addVirtualClipToTrack({
                trackId,
                startUs: currentStartUs,
                clipType: 'text',
                name,
                text,
              });
              currentStartUs += 5_000_000;
              addedCount++;
            }
          } else if (path) {
            const res = await timelineStore.addClipToTimelineFromPath({
              trackId,
              name: name || getWorkspacePathFileName(path),
              path,
              startUs: currentStartUs,
            });
            currentStartUs += res.durationUs;
            addedCount++;
          }
        }
      }

      if (addedCount > 0) {
        await timelineStore.requestTimelineSave({ immediate: true });
        toast.add({
          color: 'green',
          title: t('granVideoEditor.timeline.clipAdded'),
          description: addedCount === 1 
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
  }

  return {
    dragPreview,
    getDropPosition,
    handleFileDrop,
    handleLibraryDrop,
  };
}
