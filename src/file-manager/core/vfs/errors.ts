/**
 * Typed error hierarchy for VFS adapters.
 *
 * Adapters and Router code throw these instead of raw `Error` so callers can
 * react to specific conditions (missing file, conflict, unsupported op…) by
 * `instanceof` check rather than string matching.
 */

export type VfsErrorCode =
  | 'not-found'
  | 'conflict'
  | 'invalid-argument'
  | 'unsupported'
  | 'permission'
  | 'aborted'
  | 'io'
  | 'depth-exceeded';

export class VfsError extends Error {
  readonly code: VfsErrorCode;
  readonly path?: string;
  override readonly cause?: unknown;

  constructor(
    code: VfsErrorCode,
    message: string,
    options?: { path?: string; cause?: unknown },
  ) {
    super(message);
    this.name = 'VfsError';
    this.code = code;
    this.path = options?.path;
    this.cause = options?.cause;
  }
}

export class VfsNotFoundError extends VfsError {
  constructor(path: string, options?: { cause?: unknown }) {
    super('not-found', `Path not found: ${path}`, { path, cause: options?.cause });
    this.name = 'VfsNotFoundError';
  }
}

export class VfsConflictError extends VfsError {
  constructor(path: string, message?: string, options?: { cause?: unknown }) {
    super('conflict', message ?? `Conflict at path: ${path}`, { path, cause: options?.cause });
    this.name = 'VfsConflictError';
  }
}

export class VfsInvalidArgumentError extends VfsError {
  constructor(message: string, options?: { path?: string; cause?: unknown }) {
    super('invalid-argument', message, options);
    this.name = 'VfsInvalidArgumentError';
  }
}

export class VfsUnsupportedError extends VfsError {
  constructor(operation: string, options?: { path?: string; cause?: unknown }) {
    super('unsupported', `Operation not supported: ${operation}`, options);
    this.name = 'VfsUnsupportedError';
  }
}

export class VfsPermissionError extends VfsError {
  constructor(path: string, options?: { cause?: unknown }) {
    super('permission', `Permission denied: ${path}`, { path, cause: options?.cause });
    this.name = 'VfsPermissionError';
  }
}

export class VfsDepthExceededError extends VfsError {
  constructor(maxDepth: number, options?: { path?: string; cause?: unknown }) {
    super('depth-exceeded', `Maximum traversal depth exceeded (${maxDepth})`, options);
    this.name = 'VfsDepthExceededError';
  }
}

export class VfsIoError extends VfsError {
  constructor(message: string, options?: { path?: string; cause?: unknown }) {
    super('io', message, options);
    this.name = 'VfsIoError';
  }
}

/**
 * Throws a DOMException AbortError. Adapters should call this on `signal.aborted`
 * for consistency with stream/fetch APIs that already use DOMException.
 */
export function throwIfAborted(signal: AbortSignal | undefined, path?: string): void {
  if (signal?.aborted) {
    const reason =
      signal.reason instanceof Error
        ? signal.reason.message
        : typeof signal.reason === 'string'
          ? signal.reason
          : 'The operation was aborted.';
    throw new DOMException(path ? `${reason} (${path})` : reason, 'AbortError');
  }
}

/**
 * Normalizes platform-specific filesystem errors into our typed hierarchy.
 * Handles DOMException-style names (NotFoundError, TypeMismatchError, …) emitted
 * by the OPFS API and Node-style `code` fields (ENOENT, EEXIST, EXDEV, …) emitted
 * by Tauri / Node.
 */
export function wrapPlatformError(error: unknown, path: string): VfsError {
  if (error instanceof VfsError) return error;

  // DOMException / Error with .name
  if (error instanceof Error) {
    const name = error.name;
    if (name === 'NotFoundError') return new VfsNotFoundError(path, { cause: error });
    if (name === 'TypeMismatchError')
      return new VfsConflictError(path, `Type mismatch at ${path}`, { cause: error });
    if (name === 'InvalidModificationError')
      return new VfsConflictError(path, `Invalid modification at ${path}`, { cause: error });
    if (name === 'NotAllowedError' || name === 'SecurityError')
      return new VfsPermissionError(path, { cause: error });
    if (name === 'AbortError') {
      // Pass abort through as a DOMException so callers can use the same abort
      // protocol everywhere. Returning a VfsError would break that contract.
      throw error;
    }

    // Node-style codes (Tauri plugin-fs surfaces these in message bodies).
    const code = (error as { code?: string }).code;
    if (code === 'ENOENT') return new VfsNotFoundError(path, { cause: error });
    if (code === 'EEXIST')
      return new VfsConflictError(path, `Already exists: ${path}`, { cause: error });
    if (code === 'EACCES' || code === 'EPERM')
      return new VfsPermissionError(path, { cause: error });
    if (code === 'EXDEV')
      return new VfsError('io', `Cross-device link: ${path}`, { path, cause: error });

    return new VfsIoError(error.message || `I/O error at ${path}`, { path, cause: error });
  }

  return new VfsIoError(`I/O error at ${path}`, { path, cause: error });
}

/** Heuristic: is this a "not found" platform error? Used where we want to swallow it. */
export function isNotFoundError(error: unknown): boolean {
  if (error instanceof VfsNotFoundError) return true;
  if (error instanceof Error) {
    if (error.name === 'NotFoundError') return true;
    const code = (error as { code?: string }).code;
    if (code === 'ENOENT') return true;
    // Tauri plugin-fs surfaces stat errors as plain messages.
    return /not found|enoent|os error 2\b/i.test(error.message);
  }
  return false;
}

/** Heuristic: is this an EXDEV cross-device error from a rename? */
export function isCrossDeviceError(error: unknown): boolean {
  if (error instanceof VfsError && error.code === 'io' && /cross-device/i.test(error.message))
    return true;
  if (error instanceof Error) {
    if ((error as { code?: string }).code === 'EXDEV') return true;
    return /exdev|cross-device|different (file )?systems?/i.test(error.message);
  }
  return false;
}
