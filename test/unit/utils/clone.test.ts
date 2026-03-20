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
});
