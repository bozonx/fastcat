import type { useAppClipboard } from '~/composables/useAppClipboard';
import type { useTimelineStore } from '~/stores/timeline.store';

export interface UseMobileTimelineBatchActionsOptions {
  clipboardStore: ReturnType<typeof useAppClipboard>;
  timelineStore: ReturnType<typeof useTimelineStore>;
}

export function useMobileTimelineBatchActions(options: UseMobileTimelineBatchActionsOptions) {
  const { clipboardStore, timelineStore } = options;
  const { t } = useI18n();
  const toast = useToast();

  function showPasteToast(operation: 'copy' | 'cut') {
    toast.add({
      title: operation === 'cut' ? t('common.cutToClipboard') : t('common.copiedToClipboard'),
      color: 'success',
      icon: 'i-heroicons-clipboard-document-check',
      actions: [
        {
          label: t('common.paste'),
          onClick: () => {
            const payload = clipboardStore.clipboardPayload;
            if (!payload || payload.source !== 'timeline' || payload.items.length === 0) return;
            const playheadUs = timelineStore.currentTime;
            void timelineStore.pasteClips(payload.items, { insertStartUs: playheadUs });
            if (payload.operation === 'cut') {
              clipboardStore.setClipboardPayload(null);
            }
          },
        },
      ],
    });
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
    showPasteToast('copy');
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
    showPasteToast('cut');
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
