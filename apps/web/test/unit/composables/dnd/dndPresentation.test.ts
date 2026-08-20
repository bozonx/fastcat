import { describe, expect, it } from 'vitest';

import { getDndBadge, getDndLabelKey } from '~/composables/dnd/dndPresentation';
import type { DndOperation } from '~/composables/dnd/dndTypes';

describe('getDndBadge', () => {
  const t = (key: string) => key;

  it('maps copy/timeline-add to a green "+" badge', () => {
    expect(getDndBadge('copy', t)).toMatchObject({
      glyph: '+',
      color: 'green',
      label: 'videoEditor.fileManager.drag.copy',
      visible: true,
    });
    expect(getDndBadge('timeline-add', t)).toMatchObject({ glyph: '+', color: 'green' });
  });

  it('maps cancel to a red badge', () => {
    expect(getDndBadge('cancel', t)).toMatchObject({
      color: 'red',
      label: 'videoEditor.fileManager.drag.notAllowed',
    });
  });

  it('exposes stable translation keys for labelled operations', () => {
    expect(getDndLabelKey('move')).toBe('videoEditor.fileManager.drag.move');
    expect(getDndLabelKey('open-panel')).toBe('videoEditor.fileManager.drag.addAsPanel');
    expect(getDndLabelKey('transition')).toBe('videoEditor.fileManager.drag.addTransition');
    expect(getDndLabelKey('none')).toBe('');
  });

  it('always returns a visible badge so an active drag is never invisible', () => {
    const ops: DndOperation[] = [
      'copy',
      'move',
      'cancel',
      'timeline-add',
      'open-panel',
      'open-tab',
      'effect',
      'transition',
      'none',
    ];
    for (const op of ops) {
      expect(getDndBadge(op, t).visible).toBe(true);
    }
  });
});
