/**
 * Pure mapping from a {@link DndOperation} to the ghost badge presentation
 * (glyph, accent colour, label). Kept separate from the component so it can be
 * unit-tested and reused (e.g. by drop-zone highlights).
 */
import type { DndOperation } from './dndTypes';

type DndTranslate = (key: string) => string;

export interface DndBadge {
  glyph: string;
  /** Tailwind-ish accent colour token for the badge background. */
  color: 'green' | 'amber' | 'red' | 'blue';
  label: string;
  /** Whether the ghost should render at all for this operation. */
  visible: boolean;
}

export function getDndLabelKey(operation: DndOperation): string {
  switch (operation) {
    case 'copy':
      return 'videoEditor.fileManager.drag.copy';
    case 'move':
      return 'videoEditor.fileManager.drag.move';
    case 'cancel':
      return 'videoEditor.fileManager.drag.notAllowed';
    case 'timeline-add':
      return 'videoEditor.fileManager.drag.addToTimeline';
    case 'open-panel':
      return 'videoEditor.fileManager.drag.addAsPanel';
    case 'open-tab':
      return 'videoEditor.fileManager.drag.addAsTab';
    case 'effect':
      return 'videoEditor.fileManager.drag.applyEffect';
    case 'transition':
      return 'videoEditor.fileManager.drag.addTransition';
    case 'none':
    default:
      return '';
  }
}

export function getDndBadge(operation: DndOperation, t: DndTranslate): DndBadge {
  switch (operation) {
    case 'copy':
      return { glyph: '+', color: 'green', label: t(getDndLabelKey(operation)), visible: true };
    case 'move':
      return { glyph: '↘', color: 'amber', label: t(getDndLabelKey(operation)), visible: true };
    case 'cancel':
      return { glyph: '✕', color: 'red', label: t(getDndLabelKey(operation)), visible: true };
    case 'timeline-add':
      // No text label — the "+" glyph + the dragged item's name already make it
      // obvious it'll be added to the timeline.
      return { glyph: '+', color: 'green', label: '', visible: true };
    case 'open-panel':
      return { glyph: '▦', color: 'blue', label: t(getDndLabelKey(operation)), visible: true };
    case 'open-tab':
      return { glyph: '+', color: 'blue', label: t(getDndLabelKey(operation)), visible: true };
    case 'effect':
      return { glyph: '✦', color: 'green', label: t(getDndLabelKey(operation)), visible: true };
    case 'transition':
      return { glyph: '⇄', color: 'green', label: t(getDndLabelKey(operation)), visible: true };
    case 'none':
    default:
      return {
        glyph: '✕',
        color: 'red',
        label: t('videoEditor.fileManager.drag.notAllowed'),
        visible: true,
      };
  }
}
