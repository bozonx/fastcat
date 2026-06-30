/**
 * Pure mapping from a {@link DndOperation} to the ghost badge presentation
 * (glyph, accent colour, label). Kept separate from the component so it can be
 * unit-tested and reused (e.g. by drop-zone highlights).
 */
import type { DndOperation } from './dndTypes';

export interface DndBadge {
  glyph: string;
  /** Tailwind-ish accent colour token for the badge background. */
  color: 'green' | 'amber' | 'red' | 'blue';
  label: string;
  /** Whether the ghost should render at all for this operation. */
  visible: boolean;
}

export function getDndBadge(operation: DndOperation): DndBadge {
  switch (operation) {
    case 'copy':
      return { glyph: '+', color: 'green', label: 'Copy', visible: true };
    case 'move':
      return { glyph: '↘', color: 'amber', label: 'Move', visible: true };
    case 'cancel':
      return { glyph: '✕', color: 'red', label: 'Not allowed', visible: true };
    case 'timeline-add':
      return { glyph: '+', color: 'green', label: 'Add to timeline', visible: true };
    case 'open-panel':
      return { glyph: '▦', color: 'blue', label: 'Add as panel', visible: true };
    case 'open-tab':
      return { glyph: '+', color: 'blue', label: 'Add as tab', visible: true };
    case 'effect':
      return { glyph: '✦', color: 'green', label: 'Apply effect', visible: true };
    case 'transition':
      return { glyph: '⇄', color: 'green', label: 'Add transition', visible: true };
    case 'none':
    default:
      // Active drag but not over a valid target: neutral "carrying" ghost.
      return { glyph: '·', color: 'amber', label: '', visible: true };
  }
}
