/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { cloneValue } from '~/utils/clone';

describe('cloneValue', () => {
  it('should clone primitives', () => {
    expect(cloneValue(42)).toBe(42);
    expect(cloneValue('string')).toBe('string');
    expect(cloneValue(true)).toBe(true);
    expect(cloneValue(null)).toBeNull();
    expect(cloneValue(undefined)).toBeUndefined();
  });

  it('should clone arrays', () => {
    const arr = [1, 2, { a: 3 }];
    const cloned = cloneValue(arr);
    expect(cloned).toEqual(arr);
    expect(cloned).not.toBe(arr);
    expect(cloned[2]).not.toBe(arr[2]);
  });

  it('should clone objects', () => {
    const obj = { a: 1, b: { c: 2 } };
    const cloned = cloneValue(obj);
    expect(cloned).toEqual(obj);
    expect(cloned).not.toBe(obj);
    expect(cloned.b).not.toBe(obj.b);
  });

  it('should preserve structured types a JSON round-trip would mangle', () => {
    const date = new Date('2020-01-02T03:04:05.000Z');
    const obj = { date, map: new Map([['k', 1]]), keep: undefined as number | undefined };
    const cloned = cloneValue(obj);
    expect(cloned.date).toBeInstanceOf(Date);
    expect(cloned.date.getTime()).toBe(date.getTime());
    expect(cloned.date).not.toBe(date);
    expect(cloned.map).toBeInstanceOf(Map);
    expect(cloned.map.get('k')).toBe(1);
    // explicit undefined keys survive (JSON.stringify would drop them)
    expect('keep' in cloned).toBe(true);
  });

  it('should fall back to a JSON copy for values structuredClone cannot handle', () => {
    // Functions make structuredClone throw; the fallback strips them like the
    // previous JSON-based clones did, instead of crashing the caller.
    const obj = { a: 1, fn: () => 42, nested: { b: 2 } };
    const cloned = cloneValue(obj);
    expect(cloned.a).toBe(1);
    expect(cloned.nested).toEqual({ b: 2 });
    expect(cloned.nested).not.toBe(obj.nested);
    expect(cloned.fn).toBeUndefined();
  });
});
