import type { IFileSystemAdapter, VfsProgressReporter } from './types';
import { MAX_COPY_DEPTH } from '~/file-manager/core/rules';
import { LARGE_FILE_PROGRESS_THRESHOLD_BYTES } from './constants';
import { VfsDepthExceededError, throwIfAborted } from './errors';
import { getNextIncrementName } from '~/utils/filename-increment';

export interface CrossVfsCopyOptions {
  sourceVfs: IFileSystemAdapter;
  targetVfs: IFileSystemAdapter;
  sourcePath: string;
  sourceKind: 'file' | 'directory';
  targetDirPath: string;
  signal?: AbortSignal;
  /** Optional reporter — when given, large copies surface progress through it. */
  progressReporter?: VfsProgressReporter;
}

const MAX_UNIQUE_NAME_ATTEMPTS = 10_000;

/**
 * Replaces characters that are illegal on local filesystems (Windows is the
 * strictest of the platforms we target). Spaces, dashes and other printable
 * characters are preserved — over-sanitizing turns familiar filenames into
 * unreadable strings of dashes.
 */
function sanitizeLocalEntryName(name: string): string {
  const sanitized = name
    .replace(/[<>:"/\\|?*]/g, '-')
    // eslint-disable-next-line no-control-regex -- strip C0 control characters
    .replace(/[\x00-\x1f]/g, '')
    // Windows forbids trailing spaces and dots on entry names.
    .replace(/[. ]+$/g, '')
    .trim();

  return sanitized || 'untitled';
}

function normalizeTargetEntryName(name: string, targetVfs: IFileSystemAdapter): string {
  if (targetVfs.preservesEntryNames) {
    return name;
  }
  return sanitizeLocalEntryName(name);
}

function pickUniqueName(name: string, taken: Set<string>): string {
  const proposed = getNextIncrementName({
    fileName: name,
    existingNames: taken,
    style: 'parentheses',
    padWidth: 1,
    startIndex: 1,
    forceIndex: false,
  });

  if (taken.has(proposed)) {
    throw new Error(`Unable to generate unique entry name for "${name}": too many conflicts`);
  }

  return proposed;
}

async function generateUniqueTargetName(
  rawName: string,
  targetVfs: IFileSystemAdapter,
  targetDirPath: string,
): Promise<string> {
  const normalized = normalizeTargetEntryName(rawName, targetVfs);
  const existingNames = await targetVfs.listEntryNames(targetDirPath || '');
  return pickUniqueName(normalized, new Set(existingNames));
}

/**
 * Pipes one file from source to target via streams. When `totalBytes` is large
 * enough and a `progressReporter` is supplied, wires up a progress handle.
 */
async function copyFileAcross(
  sourceVfs: IFileSystemAdapter,
  targetVfs: IFileSystemAdapter,
  sourcePath: string,
  targetPath: string,
  signal: AbortSignal | undefined,
  totalBytes: number,
  reporter: VfsProgressReporter | undefined,
): Promise<void> {
  throwIfAborted(signal, sourcePath);

  const readStream = await sourceVfs.readStream(sourcePath, { signal });
  const writeStream = await targetVfs.writeStream(targetPath, { signal });

  const wantProgress = !!reporter && totalBytes > LARGE_FILE_PROGRESS_THRESHOLD_BYTES;

  if (!wantProgress) {
    await readStream.pipeTo(writeStream, { signal });
    return;
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal) {
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  }

  const fileName = sourcePath.split('/').pop() || sourcePath;
  const handle = reporter!.start({
    title: `Copying ${fileName}…`,
    operation: 'copy',
    fileName,
    totalBytes,
    cancel: abort,
  });

  let loaded = 0;
  const progressStream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) {
      loaded = Math.min(loaded + chunk.length, totalBytes);
      handle.update(totalBytes > 0 ? loaded / totalBytes : 1);
      ctl.enqueue(chunk);
    },
  });

  try {
    await readStream
      .pipeThrough(progressStream, { signal: controller.signal })
      .pipeTo(writeStream, { signal: controller.signal });
    handle.complete();
  } catch (e) {
    if (controller.signal.aborted) {
      handle.cancel();
    } else {
      handle.fail(e);
    }
    throw e;
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

/**
 * Read the byte size of `path` from `vfs`, returning 0 if metadata isn't
 * available. Used only to decide whether a copy is "large enough" to register
 * progress UI; failures must never break the copy itself.
 */
async function safeReadSize(vfs: IFileSystemAdapter, path: string): Promise<number> {
  if (typeof vfs.getMetadata !== 'function') return 0;
  try {
    const meta = await vfs.getMetadata(path);
    return meta?.size ?? 0;
  } catch {
    return 0;
  }
}

export interface CrossVfsExactCopyOptions {
  sourceVfs: IFileSystemAdapter;
  targetVfs: IFileSystemAdapter;
  sourcePath: string;
  /** Fully resolved target path. The caller is responsible for picking the name. */
  targetPath: string;
  signal?: AbortSignal;
  progressReporter?: VfsProgressReporter;
}

/**
 * Copies a single file between adapters to an explicit `targetPath` (no name
 * negotiation). Intended for callers that already know exactly where the file
 * should land — e.g. `RouterFileSystemAdapter.copyFile` which honors the
 * caller-supplied target. For the "drop-into-folder, auto-pick name" flow,
 * use `crossVfsCopy` instead.
 */
export async function crossVfsCopyFile(options: CrossVfsExactCopyOptions): Promise<void> {
  const size = await safeReadSize(options.sourceVfs, options.sourcePath);
  await copyFileAcross(
    options.sourceVfs,
    options.targetVfs,
    options.sourcePath,
    options.targetPath,
    options.signal,
    size,
    options.progressReporter,
  );
}

/**
 * Copies a directory tree between adapters to an explicit `targetPath` (no
 * top-level name negotiation). Child names are still sanitized for the target
 * adapter so cross-platform paths land safely on local filesystems.
 */
export async function crossVfsCopyDirectory(options: CrossVfsExactCopyOptions): Promise<void> {
  await copyDirectoryAcross(
    options.sourceVfs,
    options.targetVfs,
    options.sourcePath,
    options.targetPath,
    options.signal,
    options.progressReporter,
    0,
  );
}

export async function crossVfsCopy(options: CrossVfsCopyOptions): Promise<string> {
  const { sourceVfs, targetVfs, sourcePath, sourceKind, targetDirPath } = options;

  const sourceName = sourcePath.split('/').pop() || sourcePath;
  const targetName = await generateUniqueTargetName(sourceName, targetVfs, targetDirPath);
  const targetPath = targetDirPath ? `${targetDirPath}/${targetName}` : targetName;

  if (sourceKind === 'file') {
    const size = await safeReadSize(sourceVfs, sourcePath);
    await copyFileAcross(
      sourceVfs,
      targetVfs,
      sourcePath,
      targetPath,
      options.signal,
      size,
      options.progressReporter,
    );
    return targetPath;
  }

  await copyDirectoryAcross(
    sourceVfs,
    targetVfs,
    sourcePath,
    targetPath,
    options.signal,
    options.progressReporter,
    0,
  );
  return targetPath;
}

async function copyDirectoryAcross(
  sourceVfs: IFileSystemAdapter,
  targetVfs: IFileSystemAdapter,
  sourcePath: string,
  targetPath: string,
  signal: AbortSignal | undefined,
  reporter: VfsProgressReporter | undefined,
  depth: number,
): Promise<void> {
  throwIfAborted(signal, sourcePath);
  if (depth > MAX_COPY_DEPTH) {
    throw new VfsDepthExceededError(MAX_COPY_DEPTH, { path: sourcePath });
  }

  await targetVfs.createDirectory(targetPath);
  const entries = await sourceVfs.readDirectory(sourcePath);

  // We just created targetPath, so collisions can only come from sanitization
  // folding two distinct source names into one. Track locally to avoid I/O.
  const usedNames = new Set<string>();
  for (const entry of entries) {
    const normalized = normalizeTargetEntryName(entry.name, targetVfs);
    const unique = pickUniqueName(normalized, usedNames);
    usedNames.add(unique);
    const nextTargetPath = targetPath ? `${targetPath}/${unique}` : unique;
    if (entry.kind === 'directory') {
      await copyDirectoryAcross(
        sourceVfs,
        targetVfs,
        entry.path,
        nextTargetPath,
        signal,
        reporter,
        depth + 1,
      );
    } else {
      const size = (await safeReadSize(sourceVfs, entry.path)) || (entry.size ?? 0);
      await copyFileAcross(
        sourceVfs,
        targetVfs,
        entry.path,
        nextTargetPath,
        signal,
        size,
        reporter,
      );
    }
  }
}

export async function crossVfsMove(options: CrossVfsCopyOptions): Promise<string> {
  const targetPath = await crossVfsCopy(options);
  // Only attempt source delete after a successful copy. If the copy throws,
  // we leave the source intact — safer than partial loss.
  await options.sourceVfs.deleteEntry(options.sourcePath, true);
  return targetPath;
}
