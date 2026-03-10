import type { IFileSystemAdapter, VfsEntry } from './types';

export interface VfsRoute {
  prefix: string;
  adapter: IFileSystemAdapter;
  stripPrefix: (path: string) => string;
}

export class RouterFileSystemAdapter implements IFileSystemAdapter {
  id = 'router';

  constructor(
    private defaultAdapter: IFileSystemAdapter,
    private routes: VfsRoute[],
  ) {}

  private getRoute(path: string) {
    for (const route of this.routes) {
      if (path.startsWith(route.prefix) || path === route.prefix) {
        return { adapter: route.adapter, mappedPath: route.stripPrefix(path) };
      }
    }
    return { adapter: this.defaultAdapter, mappedPath: path };
  }

  async init(): Promise<void> {
    await this.defaultAdapter.init();
    for (const route of this.routes) {
      await route.adapter.init();
    }
  }

  async readDirectory(path: string): Promise<VfsEntry[]> {
    const { adapter, mappedPath } = this.getRoute(path);
    const entries = await adapter.readDirectory(mappedPath);
    // Map paths back to routed paths
    return entries.map((entry) => ({
      ...entry,
      path: this.restorePrefix(path, entry.path, mappedPath),
      parentPath: entry.parentPath ? this.restorePrefix(path, entry.parentPath, mappedPath) : path,
    }));
  }

  private restorePrefix(
    originalPath: string,
    mappedEntryPath: string,
    mappedOriginalPath: string,
  ): string {
    // If the router stripped a prefix, we need to add it back
    for (const route of this.routes) {
      if (originalPath.startsWith(route.prefix) || originalPath === route.prefix) {
        if (mappedOriginalPath === '') {
          return mappedEntryPath ? `${route.prefix}/${mappedEntryPath}` : route.prefix;
        }
        // Basic heuristic: replace mapped Original Path part with original Path
        if (mappedEntryPath.startsWith(mappedOriginalPath)) {
          const relative = mappedEntryPath.slice(mappedOriginalPath.length);
          return originalPath + relative;
        }
        return `${route.prefix}/${mappedEntryPath}`;
      }
    }
    return mappedEntryPath;
  }

  async createDirectory(path: string): Promise<void> {
    const { adapter, mappedPath } = this.getRoute(path);
    return adapter.createDirectory(mappedPath);
  }

  async listEntryNames(path: string): Promise<string[]> {
    const { adapter, mappedPath } = this.getRoute(path);
    return adapter.listEntryNames(mappedPath);
  }

  async readFile(path: string): Promise<Blob> {
    const { adapter, mappedPath } = this.getRoute(path);
    return adapter.readFile(mappedPath);
  }

  async writeFile(path: string, data: Blob | Uint8Array | string): Promise<void> {
    const { adapter, mappedPath } = this.getRoute(path);
    return adapter.writeFile(mappedPath, data);
  }

  async readStream(path: string): Promise<ReadableStream<Uint8Array>> {
    const { adapter, mappedPath } = this.getRoute(path);
    return adapter.readStream(mappedPath);
  }

  async writeStream(path: string): Promise<WritableStream<Uint8Array>> {
    const { adapter, mappedPath } = this.getRoute(path);
    return adapter.writeStream(mappedPath);
  }

  async deleteEntry(path: string, recursive?: boolean): Promise<void> {
    const { adapter, mappedPath } = this.getRoute(path);
    return adapter.deleteEntry(mappedPath, recursive);
  }

  async moveEntry(sourcePath: string, targetPath: string): Promise<void> {
    const sourceRoute = this.getRoute(sourcePath);
    const targetRoute = this.getRoute(targetPath);

    if (sourceRoute.adapter === targetRoute.adapter) {
      return sourceRoute.adapter.moveEntry(sourceRoute.mappedPath, targetRoute.mappedPath);
    }

    // Cross-adapter move
    await this.copyFile(sourcePath, targetPath);
    await sourceRoute.adapter.deleteEntry(sourceRoute.mappedPath, true);
  }

  async copyFile(sourcePath: string, targetPath: string): Promise<void> {
    const sourceRoute = this.getRoute(sourcePath);
    const targetRoute = this.getRoute(targetPath);

    if (sourceRoute.adapter === targetRoute.adapter) {
      return sourceRoute.adapter.copyFile(sourceRoute.mappedPath, targetRoute.mappedPath);
    }

    // Cross-adapter copy using streams
    const readStream = await sourceRoute.adapter.readStream(sourceRoute.mappedPath);
    const writeStream = await targetRoute.adapter.writeStream(targetRoute.mappedPath);
    await readStream.pipeTo(writeStream);
  }

  async copyDirectory(sourcePath: string, targetPath: string): Promise<void> {
    const sourceRoute = this.getRoute(sourcePath);
    const targetRoute = this.getRoute(targetPath);

    if (sourceRoute.adapter === targetRoute.adapter) {
      return sourceRoute.adapter.copyDirectory(sourceRoute.mappedPath, targetRoute.mappedPath);
    }

    // Cross-adapter copy directory
    await this.createDirectory(targetPath);
    const entries = await this.readDirectory(sourcePath);
    for (const entry of entries) {
      const nextTargetPath = `${targetPath}/${entry.name}`;
      if (entry.kind === 'directory') {
        await this.copyDirectory(entry.path, nextTargetPath);
      } else {
        await this.copyFile(entry.path, nextTargetPath);
      }
    }
  }

  async exists(path: string): Promise<boolean> {
    const { adapter, mappedPath } = this.getRoute(path);
    return adapter.exists(mappedPath);
  }

  async getMetadata(
    path: string,
  ): Promise<{ size: number; lastModified: number; kind: 'file' | 'directory' } | null> {
    const { adapter, mappedPath } = this.getRoute(path);
    return adapter.getMetadata(mappedPath);
  }

  async getObjectUrl(path: string): Promise<string> {
    const { adapter, mappedPath } = this.getRoute(path);
    return adapter.getObjectUrl(mappedPath);
  }

  async getFile(path: string): Promise<File | null> {
    const { adapter, mappedPath } = this.getRoute(path);
    return adapter.getFile(mappedPath);
  }

  async writeJson(path: string, data: unknown): Promise<void> {
    const { adapter, mappedPath } = this.getRoute(path);
    return adapter.writeJson(mappedPath, data);
  }
}
