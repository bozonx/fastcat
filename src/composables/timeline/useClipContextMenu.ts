import { computed } from 'vue';
import { buildGapContextMenu } from '~/composables/timeline/clip-context-menu/buildGapContextMenu';
import { buildMultiSelectionContextMenu } from '~/composables/timeline/clip-context-menu/buildMultiSelectionContextMenu';
import {
  buildSingleClipMainGroup,
  buildSingleItemActionGroup,
} from '~/composables/timeline/clip-context-menu/buildSingleClipContextMenu';
import { buildTransitionContextMenu } from '~/composables/timeline/clip-context-menu/buildTransitionContextMenu';
import type { UseClipContextMenuOptions } from '~/composables/timeline/clip-context-menu/types';

export function useClipContextMenu(options: UseClipContextMenuOptions) {
  const contextMenuItems = computed(() => {
    const item = options.item.value;

    if (!item) return [];
    if (item.kind === 'clip' && !options.canEditClipContent.value) return [];

    const multiSelectionMenu = buildMultiSelectionContextMenu(options);
    if (multiSelectionMenu) return multiSelectionMenu;

    const gapMenu = buildGapContextMenu(options);
    if (gapMenu) return gapMenu;

    const mainGroup = buildSingleClipMainGroup(options);
    const actionGroup = buildSingleItemActionGroup(options);
    const transitionGroups = buildTransitionContextMenu(options) ?? [];
    const result = [];
    if (mainGroup.length > 0) result.push(mainGroup);
    result.push(...transitionGroups);
    result.push(actionGroup);

    return result;
  });

  return { contextMenuItems };
}
