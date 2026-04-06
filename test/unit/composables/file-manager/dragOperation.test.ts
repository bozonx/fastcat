/** @vitest-environment node */
import { describe, expect, it } from 'vitest';

import {
  isCrossFileManagerDrag,
  resolveFileManagerDragOperation,
} from '~/composables/file-manager/dragOperation';

describe('dragOperation', () => {
  it('detects cross-manager drag only when both instance ids exist and differ', () => {
    expect(
      isCrossFileManagerDrag({
        dragSourceFileManagerInstanceId: 'sidebar',
        targetFileManagerInstanceId: 'main',
      }),
    ).toBe(true);

    expect(
      isCrossFileManagerDrag({
        dragSourceFileManagerInstanceId: 'main',
        targetFileManagerInstanceId: 'main',
      }),
    ).toBe(false);

    expect(
      isCrossFileManagerDrag({
        dragSourceFileManagerInstanceId: null,
        targetFileManagerInstanceId: 'main',
      }),
    ).toBe(false);
  });

  it('uses move by default and copy with layer1 within the same manager', () => {
    expect(
      resolveFileManagerDragOperation({
        dragSourceFileManagerInstanceId: 'main',
        targetFileManagerInstanceId: 'main',
        isLayer1Active: false,
      }),
    ).toBe('move');

    expect(
      resolveFileManagerDragOperation({
        dragSourceFileManagerInstanceId: 'main',
        targetFileManagerInstanceId: 'main',
        isLayer1Active: true,
      }),
    ).toBe('copy');
  });

  it('uses copy by default and move with layer1 across different managers', () => {
    expect(
      resolveFileManagerDragOperation({
        dragSourceFileManagerInstanceId: 'sidebar',
        targetFileManagerInstanceId: 'main',
        isLayer1Active: false,
      }),
    ).toBe('copy');

    expect(
      resolveFileManagerDragOperation({
        dragSourceFileManagerInstanceId: 'sidebar',
        targetFileManagerInstanceId: 'main',
        isLayer1Active: true,
      }),
    ).toBe('move');
  });
});
