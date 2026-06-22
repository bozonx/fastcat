import { describe, it, expect } from 'vitest';
import { getCustomPresetsByCategory } from '~/utils/presets';
import type { CustomPreset } from '~/stores/presets.store';

const makePreset = (
  id: string,
  category: CustomPreset['category'],
  order: number,
): CustomPreset => ({
  id,
  baseType: 'test',
  name: id,
  category,
  params: {},
  order,
});

describe('getCustomPresetsByCategory', () => {
  it('filters presets by category', () => {
    const presets = [
      makePreset('a', 'text', 0),
      makePreset('b', 'shape', 0),
      makePreset('c', 'text', 1),
    ];

    expect(getCustomPresetsByCategory(presets, 'text')).toHaveLength(2);
    expect(getCustomPresetsByCategory(presets, 'shape')).toHaveLength(1);
  });

  it('sorts presets by order ascending', () => {
    const presets = [
      makePreset('second', 'text', 2),
      makePreset('first', 'text', 0),
      makePreset('third', 'text', 5),
    ];

    expect(getCustomPresetsByCategory(presets, 'text').map((p) => p.id)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  it('returns a new array without mutating the source', () => {
    const presets = [makePreset('a', 'text', 0)];
    const result = getCustomPresetsByCategory(presets, 'text');

    expect(result).not.toBe(presets);
    expect(presets).toHaveLength(1);
  });
});
