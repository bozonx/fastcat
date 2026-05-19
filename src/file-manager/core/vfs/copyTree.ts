import { MAX_COPY_DEPTH } from '~/file-manager/core/rules';

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

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }
}

export async function copyDirectoryTree(
  ctx: CopyTreeContext,
  sourcePath: string,
  targetPath: string,
  options?: CopyTreeOptions,
): Promise<void> {
  await copyDirectoryTreeAt(ctx, sourcePath, targetPath, options, 0);
}

async function copyDirectoryTreeAt(
  ctx: CopyTreeContext,
  sourcePath: string,
  targetPath: string,
  options: CopyTreeOptions | undefined,
  depth: number,
): Promise<void> {
  assertNotAborted(options?.signal);
  if (depth > MAX_COPY_DEPTH) {
    throw new Error(`Maximum copy depth exceeded (${MAX_COPY_DEPTH})`);
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
