/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { normalizeHotkeys } from '~/utils/settings/normalizers/hotkeys';

describe('normalizeHotkeys', () => {
  it('returns defaults for empty input', () => {
    const result = normalizeHotkeys({});
    expect(result.layer1).toBe('Shift');
    expect(result.layer2).toBe('Control');
    expect(result.bindings).toEqual({});
  });

  it('filters invalid command ids', () => {
    const result = normalizeHotkeys({
      bindings: {
        'general.copy': ['Ctrl+C'],
        'invalid.command': ['Ctrl+X'],
      },
    });
    expect(result.bindings['general.copy']).toEqual(['Ctrl+C']);
    expect(result.bindings['invalid.command']).toBeUndefined();
  });

  it('normalizes hotkey combos and removes nulls', () => {
    const result = normalizeHotkeys({
      bindings: {
        'general.paste': ['Ctrl+V', '  ctrl  +  v  ', ''],
      },
    });
    expect(result.bindings['general.paste']).toEqual(['Ctrl+V']);
  });
});
