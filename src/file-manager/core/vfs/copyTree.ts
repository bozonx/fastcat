import { MAX_COPY_DEPTH } from '~/file-manager/core/rules';
import { VfsDepthExceededError, throwIfAborted } from './errors';

export interface CopyTreeEntry {
  name: string;
  kind: 'file' | 'directory';
  path: string;
}

export interface CopyTreeContext {
  readDirectory(path: string): Promise<CopyTreeEntry[]>;
  createDirectory(path: string): Promise<void>;
  copyFile(
    sourcePath: string,
    targetPath: string,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
}

export interface CopyTreeOptions {
  signal?: AbortSignal;
}

export async function copyDirectoryTree(
  ctx: CopyTreeContext,
  sourcePath: string,
  targetPath: string,
  options?: CopyTreeOptions,
): Promise<void> {
  await copyDirectoryTreeAt(ctx, sourcePath, targetPath, options, 0);
}

/**
 * Recursively copy a directory using an adapter's own primitives. Shared by the
 * VFS adapters (BloggerDog/OPFS/Tauri), whose `copyDirectory` implementations
 * are otherwise identical wiring around {@link copyDirectoryTree}.
 */
export async function copyDirectoryViaTree(
  adapter: CopyTreeContext,
  sourcePath: string,
  targetPath: string,
  options?: CopyTreeOptions,
): Promise<void> {
  await copyDirectoryTree(
    {
      readDirectory: (path) => adapter.readDirectory(path),
      createDirectory: (path) => adapter.createDirectory(path),
      copyFile: (source, target, copyOptions) => adapter.copyFile(source, target, copyOptions),
    },
    sourcePath,
    targetPath,
    options,
  );
}

async function copyDirectoryTreeAt(
  ctx: CopyTreeContext,
  sourcePath: string,
  targetPath: string,
  options: CopyTreeOptions | undefined,
  depth: number,
): Promise<void> {
  throwIfAborted(options?.signal, sourcePath);
  if (depth > MAX_COPY_DEPTH) {
    throw new VfsDepthExceededError(MAX_COPY_DEPTH, { path: sourcePath });
  }

  await ctx.createDirectory(targetPath);
  const entries = await ctx.readDirectory(sourcePath);
  for (const entry of entries) {
    const nextTargetPath = targetPath ? `${targetPath}/${entry.name}` : entry.name;
    if (entry.kind === 'directory') {
      await copyDirectoryTreeAt(ctx, entry.path, nextTargetPath, options, depth + 1);
    } else {
      await ctx.copyFile(entry.path, nextTargetPath, { signal: options?.signal });
    }
  }
}
