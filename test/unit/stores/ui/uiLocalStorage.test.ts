// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  getPlatformSuffix,
  hasLocalStorageKey,
  readLocalStorageJson,
  readLocalStorageString,
  writeLocalStorageJson,
  writeLocalStorageString,
} from '~/stores/ui/uiLocalStorage';

describe('uiLocalStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.pushState({}, '', '/');
  });

  describe('getPlatformSuffix', () => {
    it('returns empty string for desktop paths', () => {
      expect(getPlatformSuffix()).toBe('');
    });

    it('returns :mobile suffix for mobile paths', () => {
      window.history.pushState({}, '', '/m');
      expect(getPlatformSuffix()).toBe(':mobile');

      window.history.pushState({}, '', '/m/editor');
      expect(getPlatformSuffix()).toBe(':mobile');
    });
  });

  describe('hasLocalStorageKey', () => {
    it('returns false if key does not exist', () => {
      expect(hasLocalStorageKey('test-key')).toBe(false);
    });

    it('returns true if key exists', () => {
      localStorage.setItem('test-key', 'value');
      expect(hasLocalStorageKey('test-key')).toBe(true);
    });
  });

  describe('read/write LocalStorageString', () => {
    it('reads fallback when key is not present', () => {
      expect(readLocalStorageString('missing', 'fallback')).toBe('fallback');
    });

    it('reads stored string value', () => {
      writeLocalStorageString('key', 'hello');
      expect(readLocalStorageString('key', 'fallback')).toBe('hello');
    });
  });

  describe('read/write LocalStorageJson', () => {
    it('reads fallback when key is not present or invalid json', () => {
      expect(readLocalStorageJson('missing', { a: 1 })).toEqual({ a: 1 });

      localStorage.setItem('invalid-json', '{invalid');
      expect(readLocalStorageJson('invalid-json', { a: 1 })).toEqual({ a: 1 });
    });

    it('writes and reads JSON objects', () => {
      const data = { foo: 'bar', count: 42 };
      writeLocalStorageJson('json-key', data);
      expect(readLocalStorageJson('json-key', {})).toEqual(data);
    });
  });

  describe('error handling', () => {
    let getItemSpy: any;
    let setItemSpy: any;
    let keySpy: any;

    beforeEach(() => {
      getItemSpy = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
        throw new Error('Storage disabled');
      });
      setItemSpy = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
        throw new Error('Quota exceeded');
      });
      keySpy = vi.spyOn(window.localStorage, 'key').mockImplementation(() => {
        throw new Error('Storage error');
      });
    });

    afterEach(() => {
      getItemSpy.mockRestore();
      setItemSpy.mockRestore();
      keySpy.mockRestore();
    });

    it('handles hasLocalStorageKey errors gracefully', () => {
      expect(hasLocalStorageKey('any')).toBe(false);
    });

    it('handles readLocalStorageJson errors gracefully', () => {
      expect(readLocalStorageJson('any', 'fallback')).toBe('fallback');
    });

    it('handles readLocalStorageString errors gracefully', () => {
      expect(readLocalStorageString('any', 'fallback')).toBe('fallback');
    });

    it('handles writeLocalStorageJson errors gracefully', () => {
      expect(() => writeLocalStorageJson('any', {})).not.toThrow();
    });

    it('handles writeLocalStorageString errors gracefully', () => {
      expect(() => writeLocalStorageString('any', 'value')).not.toThrow();
    });
  });
});
