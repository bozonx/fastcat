import { computed } from 'vue';
import { buildGapContextMenu } from '~/composables/timeline/clip-context-menu/buildGapContextMenu';
import { buildMultiSelectionContextMenu } from '~/composables/timeline/clip-context-menu/buildMultiSelectionContextMenu';
import {
  buildSingleClipMainGroup,
  buildSingleItemActionGroup,
} from '~/composables/timeline/clip-context-menu/buildSingleClipContextMenu';
import { buildTransitionContextMenu } from '~/composables/timeline/clip-context-menu/buildTransitionContextMenu';
import type {
  ContextMenuGroup,
  UseClipContextMenuOptions,
} from '~/composables/timeline/clip-context-menu/types';

export function useClipContextMenu(options: UseClipContextMenuOptions) {
  const contextMenuItems = computed(() => {
    const item = options.item.value;

    if (!item) return [];
    if (item.kind === 'clip' && !options.canEditClipContent.value) return [];

    const multiSelectionMenu = buildMultiSelectionContextMenu(options);
    if (multiSelectionMenu) return multiSelectionMenu;

    const gapMenu = buildGapContextMenu(options);
    if (gapMenu) return gapMenu;

    const mainGroups = buildSingleClipMainGroup(options);
    const actionGroup = buildSingleItemActionGroup(options);
    const transitionGroups = buildTransitionContextMenu(options) ?? [];
    const result: ContextMenuGroup[] = [];

    if (mainGroups.length > 0) {
      result.push(mainGroups[0]!); // Group 1: Speed and Freeze
    }
    result.push(...transitionGroups); // Group 2: Transitions
    if (mainGroups.length > 1) {
      result.push(...mainGroups.slice(1)); // Remaining groups: Auto montage, States, etc.
    }
    result.push(actionGroup); // Group 5: Actions (Copy, Paste, etc.)

    return result;
  });

  return { contextMenuItems };
}
