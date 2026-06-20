import type { useAppClipboard } from '~/composables/useAppClipboard';
import type { useTimelineStore } from '~/stores/timeline.store';

export interface UseMobileTimelineBatchActionsOptions {
  clipboardStore: ReturnType<typeof useAppClipboard>;
  timelineStore: ReturnType<typeof useTimelineStore>;
}

export function useMobileTimelineBatchActions(options: UseMobileTimelineBatchActionsOptions) {
  const { clipboardStore, timelineStore } = options;

  function handleCopyClips() {
    clipboardStore.setClipboardPayload({
      source: 'timeline',
      operation: 'copy',
      items: timelineStore.copySelectedClips().map((item) => ({
        sourceTrackId: item.sourceTrackId,
        clip: item.clip,
      })),
    });
  }

  function handleCutClips() {
    clipboardStore.setClipboardPayload({
      source: 'timeline',
      operation: 'cut',
      items: timelineStore.cutSelectedClips().map((item) => ({
        sourceTrackId: item.sourceTrackId,
        clip: item.clip,
      })),
    });
  }

  function handleBladeClips() {
    void timelineStore.splitClipAtPlayhead();
  }

  return {
    handleCopyClips,
    handleCutClips,
    handleBladeClips,
  };
}
