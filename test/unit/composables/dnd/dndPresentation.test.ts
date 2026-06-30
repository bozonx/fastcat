import { describe, expect, it } from 'vitest';

import { getDndBadge } from '~/composables/dnd/dndPresentation';
import type { DndOperation } from '~/composables/dnd/dndTypes';

describe('getDndBadge', () => {
  it('maps copy/timeline-add to a green "+" badge', () => {
    expect(getDndBadge('copy')).toMatchObject({ glyph: '+', color: 'green', visible: true });
    expect(getDndBadge('timeline-add')).toMatchObject({ glyph: '+', color: 'green' });
  });

  it('maps cancel to a red badge', () => {
    expect(getDndBadge('cancel')).toMatchObject({ color: 'red', label: 'Not allowed' });
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
      expect(getDndBadge(op).visible).toBe(true);
    }
  });
});
