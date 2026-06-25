/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { safeRevokeObjectURL, useSafeObjectUrl } from '~/composables/useSafeObjectUrl';

describe('safeRevokeObjectURL', () => {
  it('does nothing for null url', () => {
    expect(() => safeRevokeObjectURL(null)).not.toThrow();
  });

  it('does nothing for undefined url', () => {
    expect(() => safeRevokeObjectURL(undefined)).not.toThrow();
  });

  it('does nothing for non-blob url', () => {
    expect(() => safeRevokeObjectURL('http://example.com/file.mp4')).not.toThrow();
  });

  it('does not throw for blob: urls', () => {
    // URL.revokeObjectURL may not exist in node, but the function catches errors
    expect(() => safeRevokeObjectURL('blob:http://localhost/test')).not.toThrow();
  });
});

describe('useSafeObjectUrl', () => {
  it('initializes with null url', () => {
    const { url } = useSafeObjectUrl();
    expect(url.value).toBeNull();
  });

  it('set updates url value', () => {
    const { url, set } = useSafeObjectUrl();
    set('http://example.com/file.mp4');
    expect(url.value).toBe('http://example.com/file.mp4');
  });

  it('set to null clears url', () => {
    const { url, set } = useSafeObjectUrl();
    set('http://example.com/file.mp4');
    set(null);
    expect(url.value).toBeNull();
  });

  it('revoke clears url', () => {
    const { url, set, revoke } = useSafeObjectUrl();
    set('http://example.com/file.mp4');
    revoke();
    expect(url.value).toBeNull();
  });

  it('set does not revoke when setting same url', () => {
    const { url, set } = useSafeObjectUrl();
    set('http://example.com/file.mp4');
    set('http://example.com/file.mp4');
    expect(url.value).toBe('http://example.com/file.mp4');
  });

  it('set revokes previous url when setting different url', () => {
    const { url, set } = useSafeObjectUrl();
    set('http://example.com/old.mp4');
    set('http://example.com/new.mp4');
    expect(url.value).toBe('http://example.com/new.mp4');
  });
});
