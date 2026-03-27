import type { ContextMenuGroup, UseClipContextMenuOptions } from './types';

export function buildGapContextMenu(options: UseClipContextMenuOptions): ContextMenuGroup[] | null {
  const track = options.track.value;
  const item = options.item.value;

  if (item.kind !== 'gap') return null;

  return [
    [
      {
        label: options.t('common.paste'),
        icon: 'i-heroicons-clipboard',
        disabled: !options.hasTimelineClipboard,
        onSelect: () => {
          options.pasteClips(item.timelineRange.startUs);
        },
      },
      {
        label: options.t('fastcat.timeline.delete'),
        icon: 'i-heroicons-trash',
        onSelect: () => {
          options.applyTimelineCommand({
            type: 'delete_items',
            trackId: track.id,
            itemIds: [item.id],
          });
        },
      },
    ],
  ];
}
