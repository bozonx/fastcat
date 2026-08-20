/**
 * Registers a drop zone with the pointer-DnD engine for the lifetime of the
 * calling component. The component must render `v-bind="zoneAttrs"` (or set
 * `:data-dnd-zone-id`) on the element that should accept drops, so the engine's
 * hit-test can resolve it.
 */
import { onScopeDispose } from 'vue';
import { DND_ZONE_ATTR, registerDndZone, unregisterDndZone } from './dndRegistry';
import type { DndDropZoneHandlers } from './dndTypes';

let zoneSeq = 0;

export function useDndDropZone(handlers: DndDropZoneHandlers, idHint?: string) {
  const zoneId = idHint ? `${idHint}-${++zoneSeq}` : `dnd-zone-${++zoneSeq}`;

  registerDndZone(zoneId, handlers);

  onScopeDispose(() => {
    unregisterDndZone(zoneId);
  });

  return {
    zoneId,
    /** Spread onto the drop-accepting element: `v-bind="zoneAttrs"`. */
    zoneAttrs: { [DND_ZONE_ATTR]: zoneId } as Record<string, string>,
  };
}
