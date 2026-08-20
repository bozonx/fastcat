/**
 * Drop-zone registry for the pointer-DnD engine.
 *
 * Because pointer events (unlike HTML5 DnD) do not fire `dragenter`/`dragover`
 * on the elements under the pointer, the engine resolves the current drop
 * target itself: it hit-tests `elementFromPoint`, walks up to the nearest
 * element carrying `data-dnd-zone-id`, and looks the handlers up here.
 */
import type { DndDropZoneHandlers } from './dndTypes';

export const DND_ZONE_ATTR = 'data-dnd-zone-id';

const zones = new Map<string, DndDropZoneHandlers>();

export function registerDndZone(id: string, handlers: DndDropZoneHandlers): void {
  zones.set(id, handlers);
}

export function unregisterDndZone(id: string): void {
  zones.delete(id);
}

export function getDndZone(id: string): DndDropZoneHandlers | null {
  return zones.get(id) ?? null;
}

/** Test-only / teardown helper. */
export function clearDndZones(): void {
  zones.clear();
}

/**
 * Minimal shape of a DOM node needed to resolve a zone id. Kept structural so
 * the resolver is unit-testable with plain objects (no real DOM).
 */
export interface ZoneResolvableNode {
  getAttribute?(name: string): string | null;
  parentElement?: ZoneResolvableNode | null;
}

/**
 * Walks up from the hit element to the nearest ancestor carrying a zone id.
 * Returns the id of the first registered zone found, or null.
 */
export function resolveDndZoneId(el: ZoneResolvableNode | null): string | null {
  let node: ZoneResolvableNode | null = el;
  while (node) {
    const id = node.getAttribute?.(DND_ZONE_ATTR) ?? null;
    if (id && zones.has(id)) return id;
    node = node.parentElement ?? null;
  }
  return null;
}
