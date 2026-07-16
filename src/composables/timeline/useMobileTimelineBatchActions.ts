import type { useAppClipboard } from '~/composables/useAppClipboard';
import type { useTimelineStore } from '~/stores/timeline.store';

export interface UseMobileTimelineBatchActionsOptions {
  clipboardStore: ReturnType<typeof useAppClipboard>;
  timelineStore: ReturnType<typeof useTimelineStore>;
}

export function useMobileTimelineBatchActions(options: UseMobileTimelineBatchActionsOptions) {
  const { clipboardStore, timelineStore } = options;

  // Paste the clipboard contents at the playhead, select the freshly pasted
  // clips and scroll the timeline so they are visible (the scroll is a no-op
  // when the playhead is already on screen).
  async function handlePasteClips() {
    const payload = clipboardStore.clipboardPayload;
    if (!payload || payload.source !== 'timeline' || payload.items.length === 0) return;
    const playheadTicks = timelineStore.currentTime;
    const pasted = await timelineStore.pasteClips(payload.items, { insertStartTicks: playheadTicks });
    if (payload.operation === 'cut') {
      clipboardStore.setClipboardPayload(null);
    }
    if (pasted.length > 0) {
      timelineStore.selectTimelineItems(pasted);
      timelineStore.requestScrollToPlayhead();
    }
  }

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
    handlePasteClips,
  };
}
