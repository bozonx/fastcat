export interface VfsEntry {
  name: string;
  kind: 'file' | 'directory';
  path: string;
  parentPath?: string;
  lastModified?: number;
  createdAt?: number;
  size?: number;
  children?: VfsEntry[];
  expanded?: boolean;
  hasChildren?: boolean;
  hasDirectories?: boolean;
  adapterPayload?: unknown;
}

export interface VfsEntryMetadata {
  size: number;
  lastModified: number;
  createdAt?: number;
  kind: 'file' | 'directory';
}

export interface VfsReadDirectoryOptions {
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
  /**
   * When true, the adapter checks each sub-directory and populates
   * `hasChildren` / `hasDirectories` on returned entries.
   *
   * This costs one extra read per sub-directory — keep it off for big folders.
   */
  checkChildren?: boolean;
  /** Abort signal — may be honored by adapters that fan out concurrent reads. */
  signal?: AbortSignal;
}

export interface VfsOperationOptions {
  signal?: AbortSignal;
}

/**
 * Progress reporter that adapters can call during long-running operations.
 *
 * The Router uses this to surface cross-VFS copies in the UI (background-tasks
 * store, notifications). Adapters and the core VFS layer must not import from
 * Nuxt / Pinia / UI stores — instead, the plugin wires a reporter in.
 */
export interface VfsProgressReporter {
  /**
   * Begin tracking a long-running operation.
   *
   * `cancel` is invoked if the surrounding UI requests cancellation. The
   * returned handle is then driven through `update` / `complete` / `fail` /
   * `cancel`.
   */
  start(input: {
    title: string;
    operation: 'copy' | 'move' | 'delete' | 'other';
    fileName?: string;
    totalBytes?: number;
    cancel?: () => void;
  }): VfsProgressHandle;
}

export interface VfsProgressHandle {
  /** Progress 0..1 (clamped by the reporter implementation). */
  update(progress: number): void;
  complete(): void;
  fail(error: unknown): void;
  cancel(): void;
}

/**
 * Virtual filesystem adapter contract.
 *
 * Implementations:
 * - `OpfsFileSystemAdapter` — browser (Origin Private File System)
 * - `TauriFileSystemAdapter` — desktop (Tauri plugin-fs)
 * - `BloggerDogVfsAdapter`  — remote object store
 * - `InMemoryFileSystemAdapter` — tests / scratch
 * - `RouterFileSystemAdapter` — composes the above by path prefix
 *
 * Error contract:
 * - "not found" → `VfsNotFoundError`
 * - name collision / wrong-kind → `VfsConflictError`
 * - unsupported on this backend → `VfsUnsupportedError`
 * - bad input → `VfsInvalidArgumentError`
 * - aborted operation → `DOMException` with `name = 'AbortError'`
 *
 * Implementations should call `wrapPlatformError` from `./errors` to convert
 * raw platform errors at the boundary.
 *
 * Path conventions:
 * - Paths are POSIX-style, slash-separated. `/` and the empty string both
 *   refer to the adapter root.
 * - Adapters never traverse above their root, regardless of `..` segments
 *   (see `normalizeFsPath`).
 */
export interface IFileSystemAdapter {
  id: string;

  /**
   * When true, cross-adapter operations skip sanitization of entry names
   * (no replacement of characters illegal on local filesystems).
   * Adapters backed by APIs that accept arbitrary names (e.g. remote object
   * stores) set this.
   */
  preservesEntryNames?: boolean;

  /** Initialize the adapter (e.g. request permissions, open root handle). */
  init(): Promise<void>;

  /** Read a directory and return its child entries. */
  readDirectory(path: string, options?: VfsReadDirectoryOptions): Promise<VfsEntry[]>;

  /** Create a directory at `path`. Creates intermediate directories. No-op if exists. */
  createDirectory(path: string): Promise<void>;

  /** Return entry names in `path`. */
  listEntryNames(path: string): Promise<string[]>;

  /**
   * Read a file as a Blob.
   *
   * Throws `VfsNotFoundError` if the path doesn't exist.
   * Implementations are not required to enforce the path being a file (some
   * platforms surface that as the underlying type error).
   */
  readFile(path: string, options?: VfsOperationOptions): Promise<Blob>;

  /**
   * Write a file. Creates intermediate directories.
   *
   * Implementations SHOULD write atomically (temp file + rename) to avoid
   * leaving a partial file if the write is interrupted.
   */
  writeFile(
    path: string,
    data: Blob | Uint8Array | string,
    options?: VfsOperationOptions,
  ): Promise<void>;

  /**
   * Delete a file or directory.
   *
   * If `recursive` is true, directories are deleted along with their contents.
   * If `recursive` is false (or omitted) and the path is a non-empty directory,
   * implementations throw `VfsConflictError`.
   * Missing paths resolve silently (no error).
   */
  deleteEntry(path: string, recursive?: boolean): Promise<void>;

  /** Rename or move an entry inside the same adapter. */
  moveEntry(sourcePath: string, targetPath: string, options?: VfsOperationOptions): Promise<void>;

  /** Copy a single file. Creates parent directories of the target. */
  copyFile(sourcePath: string, targetPath: string, options?: VfsOperationOptions): Promise<void>;

  /** Copy a directory recursively. Creates the target directory. */
  copyDirectory(
    sourcePath: string,
    targetPath: string,
    options?: VfsOperationOptions,
  ): Promise<void>;

  /** Check if an entry exists. Returns false on missing paths (no throw). */
  exists(path: string): Promise<boolean>;

  /**
   * Return metadata, or null if the entry does not exist.
   *
   * For directories: `size` is 0 unless the adapter can compute it cheaply.
   * `lastModified` should be a real mtime when available; adapters that can't
   * provide one for directories return 0 (not `Date.now()`, which would lie).
   */
  getMetadata(path: string): Promise<VfsEntryMetadata | null>;

  /**
   * Return a URL suitable for playback / `<img src>`.
   *
   * Implementations MUST manage the URL lifecycle (revoke previous URL for
   * the same path on regeneration, revoke on deletion). Callers don't need
   * to revoke the returned URL.
   */
  getObjectUrl(path: string): Promise<string>;

  /**
   * Materialize a `File` object for the path, when supported.
   * Some operations (e.g. WebCodecs decoding) still need a `File`.
   * Returns `null` if the path is not a file or doesn't exist.
   */
  getFile(path: string): Promise<File | null>;

  /** Write JSON via `writeFile`. */
  writeJson(path: string, data: unknown, options?: VfsOperationOptions): Promise<void>;

  /**
   * Read file contents as a `ReadableStream`.
   *
   * Implementations that hold platform resources or I/O-budget slots for the
   * stream must release them when the stream closes, errors, or is cancelled.
   */
  readStream(path: string, options?: VfsOperationOptions): Promise<ReadableStream<Uint8Array>>;

  /**
   * Open an atomic `WritableStream` to a file. Creates parent directories.
   *
   * Bytes are staged outside the final path and committed only when the stream
   * closes successfully. Abort/error paths must remove the staged file where the
   * platform allows it.
   */
  writeStream(path: string, options?: VfsOperationOptions): Promise<WritableStream<Uint8Array>>;
}
