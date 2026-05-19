/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import {
  VfsConflictError,
  VfsDepthExceededError,
  VfsError,
  VfsInvalidArgumentError,
  VfsIoError,
  VfsNotFoundError,
  VfsPermissionError,
  VfsUnsupportedError,
  isCrossDeviceError,
  isNotFoundError,
  throwIfAborted,
  wrapPlatformError,
} from '~/file-manager/core/vfs/errors';

describe('VfsError hierarchy', () => {
  it('exposes structured code/name/path/cause on each subclass', () => {
    const cause = new Error('underlying');
    const cases: Array<{ err: VfsError; name: string; code: string; path?: string }> = [
      {
        err: new VfsNotFoundError('/a/b', { cause }),
        name: 'VfsNotFoundError',
        code: 'not-found',
        path: '/a/b',
      },
      {
        err: new VfsConflictError('/c', 'already there', { cause }),
        name: 'VfsConflictError',
        code: 'conflict',
        path: '/c',
      },
      {
        err: new VfsInvalidArgumentError('bad input', { path: '/x', cause }),
        name: 'VfsInvalidArgumentError',
        code: 'invalid-argument',
        path: '/x',
      },
      {
        err: new VfsUnsupportedError('writeStream', { path: '/x', cause }),
        name: 'VfsUnsupportedError',
        code: 'unsupported',
        path: '/x',
      },
      {
        err: new VfsPermissionError('/p', { cause }),
        name: 'VfsPermissionError',
        code: 'permission',
        path: '/p',
      },
      {
        err: new VfsDepthExceededError(10, { path: '/d' }),
        name: 'VfsDepthExceededError',
        code: 'depth-exceeded',
        path: '/d',
      },
      {
        err: new VfsIoError('disk full', { path: '/io' }),
        name: 'VfsIoError',
        code: 'io',
        path: '/io',
      },
    ];

    for (const { err, name, code, path } of cases) {
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(VfsError);
      expect(err.name).toBe(name);
      expect(err.code).toBe(code);
      if (path !== undefined) expect(err.path).toBe(path);
    }
  });
});

describe('throwIfAborted', () => {
  it('does nothing when signal is undefined or not aborted', () => {
    expect(() => throwIfAborted(undefined, '/x')).not.toThrow();
    const controller = new AbortController();
    expect(() => throwIfAborted(controller.signal, '/x')).not.toThrow();
  });

  it('throws DOMException with name AbortError when signal is aborted', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => throwIfAborted(controller.signal, '/x')).toThrowError(
      expect.objectContaining({ name: 'AbortError' }),
    );
  });

  it('uses the abort reason message when reason is an Error', () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled by user'));
    try {
      throwIfAborted(controller.signal, '/some/path');
      throw new Error('should not reach');
    } catch (e) {
      expect(e).toBeInstanceOf(DOMException);
      expect((e as DOMException).name).toBe('AbortError');
      expect((e as DOMException).message).toContain('cancelled by user');
      expect((e as DOMException).message).toContain('/some/path');
    }
  });

  it('uses string reason when supplied', () => {
    const controller = new AbortController();
    controller.abort('user-cancelled');
    expect(() => throwIfAborted(controller.signal)).toThrowError(
      expect.objectContaining({ message: 'user-cancelled', name: 'AbortError' }),
    );
  });
});

describe('wrapPlatformError', () => {
  it('returns the same VfsError unchanged when given one', () => {
    const original = new VfsNotFoundError('/x');
    expect(wrapPlatformError(original, '/x')).toBe(original);
  });

  it('maps DOMException-style names to typed errors', () => {
    const notFound = Object.assign(new Error('gone'), { name: 'NotFoundError' });
    expect(wrapPlatformError(notFound, '/x')).toBeInstanceOf(VfsNotFoundError);

    const typeMismatch = Object.assign(new Error('mismatch'), { name: 'TypeMismatchError' });
    expect(wrapPlatformError(typeMismatch, '/x')).toBeInstanceOf(VfsConflictError);

    const invalidMod = Object.assign(new Error('invalid'), { name: 'InvalidModificationError' });
    expect(wrapPlatformError(invalidMod, '/x')).toBeInstanceOf(VfsConflictError);

    const denied = Object.assign(new Error('no'), { name: 'NotAllowedError' });
    expect(wrapPlatformError(denied, '/x')).toBeInstanceOf(VfsPermissionError);

    const security = Object.assign(new Error('no'), { name: 'SecurityError' });
    expect(wrapPlatformError(security, '/x')).toBeInstanceOf(VfsPermissionError);
  });

  it('re-throws AbortError so abort protocol stays intact', () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    expect(() => wrapPlatformError(abort, '/x')).toThrow(abort);
  });

  it('maps Node-style codes to typed errors', () => {
    const enoent = Object.assign(new Error('no'), { code: 'ENOENT' });
    expect(wrapPlatformError(enoent, '/x')).toBeInstanceOf(VfsNotFoundError);

    const eexist = Object.assign(new Error('exists'), { code: 'EEXIST' });
    expect(wrapPlatformError(eexist, '/x')).toBeInstanceOf(VfsConflictError);

    const eacces = Object.assign(new Error('denied'), { code: 'EACCES' });
    expect(wrapPlatformError(eacces, '/x')).toBeInstanceOf(VfsPermissionError);

    const exdev = Object.assign(new Error('cross device'), { code: 'EXDEV' });
    const wrapped = wrapPlatformError(exdev, '/x');
    expect(wrapped).toBeInstanceOf(VfsError);
    expect((wrapped as VfsError).code).toBe('io');
  });

  it('falls back to VfsIoError for unknown errors and non-Errors', () => {
    const unknown = wrapPlatformError(new Error('whatever'), '/x');
    expect(unknown).toBeInstanceOf(VfsIoError);
    const nonError = wrapPlatformError('plain string', '/x');
    expect(nonError).toBeInstanceOf(VfsIoError);
  });
});

describe('isNotFoundError', () => {
  it('detects VfsNotFoundError instance', () => {
    expect(isNotFoundError(new VfsNotFoundError('/x'))).toBe(true);
  });

  it('detects DOMException-style NotFoundError', () => {
    const e = Object.assign(new Error('gone'), { name: 'NotFoundError' });
    expect(isNotFoundError(e)).toBe(true);
  });

  it('detects Node-style ENOENT code', () => {
    const e = Object.assign(new Error('no'), { code: 'ENOENT' });
    expect(isNotFoundError(e)).toBe(true);
  });

  it('detects Tauri-style "os error 2" message', () => {
    expect(isNotFoundError(new Error('failed: os error 2'))).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isNotFoundError(new Error('something else'))).toBe(false);
    expect(isNotFoundError(null)).toBe(false);
  });
});

describe('isCrossDeviceError', () => {
  it('detects Node-style EXDEV code', () => {
    const e = Object.assign(new Error('cross device'), { code: 'EXDEV' });
    expect(isCrossDeviceError(e)).toBe(true);
  });

  it('detects EXDEV from message text', () => {
    expect(isCrossDeviceError(new Error('Cross-device link not permitted'))).toBe(true);
    expect(isCrossDeviceError(new Error('different file systems'))).toBe(true);
  });

  it('detects io VfsError tagged as cross-device', () => {
    const wrapped = wrapPlatformError(Object.assign(new Error('x'), { code: 'EXDEV' }), '/x');
    expect(isCrossDeviceError(wrapped)).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isCrossDeviceError(new Error('I/O error'))).toBe(false);
    expect(isCrossDeviceError(null)).toBe(false);
  });
});
