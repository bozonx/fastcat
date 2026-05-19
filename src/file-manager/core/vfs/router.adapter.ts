import type {
  IFileSystemAdapter,
  VfsEntry,
  VfsEntryMetadata,
  VfsOperationOptions,
  VfsProgressReporter,
  VfsReadDirectoryOptions,
} from './types';
import { copyDirectoryTree } from './copyTree';
import { crossVfsCopy } from './crossVfs';

export interface VfsRoute {
  prefix: string;
  adapter: IFileSystemAdapter;
  stripPrefix: (path: string) => string;
}

export interface RouterFileSystemAdapterOptions {
  /**
   * Optional reporter for surfacing large cross-adapter copies in the UI.
   * The Router itself stays UI-agnostic: implement the reporter in the host
   * application (Nuxt plugin, store wiring, …).
   */
  progressReporter?: VfsProgressReporter;
}

export class RouterFileSystemAdapter implements IFileSystemAdapter {
  id = 'router';
  private sortedRoutes: VfsRoute[];
  private progressReporter: VfsProgressReporter | undefined;

  constructor(
    private defaultAdapter: IFileSystemAdapter,
    protected routes: VfsRoute[],
    options?: RouterFileSystemAdapterOptions,
  ) {
    this.sortedRoutes = this.sortRoutes(routes);
    this.progressReporter = options?.progressReporter;
  }

  /** Update the progress reporter after construction (useful at plugin wiring time). */
  setProgressReporter(reporter: VfsProgressReporter | undefined): void {
    this.progressReporter = reporter;
  }

  private sortRoutes(routes: VfsRoute[]): VfsRoute[] {
    return [...routes].sort((a, b) => b.prefix.length - a.prefix.length);
  }

  private refreshSortedRoutes(): void {
    this.sortedRoutes = this.sortRoutes(this.routes);
  }

  registerRoute(route: VfsRoute) {
    const index = this.routes.findIndex((r) => r.prefix === route.prefix);
    if (index !== -1) {
      this.routes[index] = route;
    } else {
      this.routes.push(route);
    }
    this.refreshSortedRoutes();
  }

  unregisterRoute(prefix: string) {
    this.routes = this.routes.filter((r) => r.prefix !== prefix);
    this.refreshSortedRoutes();
  }

  private routeMatches(path: string, prefix: string): boolean {
    if (path === prefix) return true;
    const normalizedPrefix = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
    return path.startsWith(`${normalizedPrefix}/`);
  }

  private getRoute(path: string) {
    for (const route of this.sortedRoutes) {
      if (this.routeMatches(path, route.prefix)) {
        return { adapter: route.adapter, mappedPath: route.stripPrefix(path), route };
      }
    }
    return { adapter: this.defaultAdapter, mappedPath: path, route: null as VfsRoute | null };
  }

  async init(): Promise<void> {
    await Promise.all([
      this.defaultAdapter.init(),
      ...this.routes.map((route) => route.adapter.init()),
    ]);
  }

  async readDirectory(path: string, options?: VfsReadDirectoryOptions): Promise<VfsEntry[]> {
    const { adapter, mappedPath } = this.getRoute(path);
    const entries = await adapter.readDirectory(mappedPath, options);
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
    // If the router stripped a prefix, we need to add it back.
    for (const route of this.sortedRoutes) {
      if (!this.routeMatches(originalPath, route.prefix)) continue;

      if (mappedOriginalPath === '') {
        return mappedEntryPath ? `${route.prefix}/${mappedEntryPath}` : route.prefix;
      }
      // The entry path is a descendant of the mapped original path. Check
      // segment boundary (or exact equality) to avoid `foo` matching `foobar`.
      if (mappedEntryPath === mappedOriginalPath) {
        return originalPath;
      }
      if (mappedEntryPath.startsWith(`${mappedOriginalPath}/`)) {
        const relative = mappedEntryPath.slice(mappedOriginalPath.length);
        return originalPath + relative;
      }
      return originalPath;
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

  async readFile(path: string, options?: VfsOperationOptions): Promise<Blob> {
    const { adapter, mappedPath } = this.getRoute(path);
    return adapter.readFile(mappedPath, options);
  }

  async writeFile(
    path: string,
    data: Blob | Uint8Array | string,
    options?: VfsOperationOptions,
  ): Promise<void> {
    const { adapter, mappedPath } = this.getRoute(path);
    return adapter.writeFile(mappedPath, data, options);
  }

  async readStream(
    path: string,
    options?: VfsOperationOptions,
  ): Promise<ReadableStream<Uint8Array>> {
    const { adapter, mappedPath } = this.getRoute(path);
    return adapter.readStream(mappedPath, options);
  }

  async writeStream(
    path: string,
    options?: VfsOperationOptions,
  ): Promise<WritableStream<Uint8Array>> {
    const { adapter, mappedPath } = this.getRoute(path);
    return adapter.writeStream(mappedPath, options);
  }

  async deleteEntry(path: string, recursive?: boolean): Promise<void> {
    const { adapter, mappedPath } = this.getRoute(path);
    return adapter.deleteEntry(mappedPath, recursive);
  }

  async moveEntry(
    sourcePath: string,
    targetPath: string,
    options?: VfsOperationOptions,
  ): Promise<void> {
    const sourceRoute = this.getRoute(sourcePath);
    const targetRoute = this.getRoute(targetPath);

    if (sourceRoute.adapter === targetRoute.adapter) {
      return sourceRoute.adapter.moveEntry(sourceRoute.mappedPath, targetRoute.mappedPath, options);
    }

    // Cross-adapter move: copy then delete, with sanitization handled by crossVfs.
    const targetParts = targetPath.split('/').filter(Boolean);
    const targetDirPath = targetParts.slice(0, -1).join('/');
    const meta = await sourceRoute.adapter.getMetadata(sourceRoute.mappedPath);
    if (!meta) {
      // Match other adapters: source missing is a not-found condition.
      const { VfsNotFoundError } = await import('./errors');
      throw new VfsNotFoundError(sourcePath);
    }

    await crossVfsCopy({
      sourceVfs: sourceRoute.adapter,
      targetVfs: targetRoute.adapter,
      sourcePath: sourceRoute.mappedPath,
      sourceKind: meta.kind,
      targetDirPath: this.getRoute(targetDirPath).mappedPath,
      signal: options?.signal,
      progressReporter: this.progressReporter,
    });

    await sourceRoute.adapter.deleteEntry(sourceRoute.mappedPath, true);
  }

  async copyFile(
    sourcePath: string,
    targetPath: string,
    options?: VfsOperationOptions,
  ): Promise<void> {
    const sourceRoute = this.getRoute(sourcePath);
    const targetRoute = this.getRoute(targetPath);

    if (sourceRoute.adapter === targetRoute.adapter) {
      return sourceRoute.adapter.copyFile(sourceRoute.mappedPath, targetRoute.mappedPath, options);
    }

    // Cross-adapter copy via the shared crossVfs implementation.
    // Path-sanitization and progress reporting live there, so router stays thin.
    const targetParts = targetPath.split('/').filter(Boolean);
    const targetDirPath = targetParts.slice(0, -1).join('/');
    await crossVfsCopy({
      sourceVfs: sourceRoute.adapter,
      targetVfs: targetRoute.adapter,
      sourcePath: sourceRoute.mappedPath,
      sourceKind: 'file',
      targetDirPath: this.getRoute(targetDirPath).mappedPath,
      signal: options?.signal,
      progressReporter: this.progressReporter,
    });
  }

  async copyDirectory(
    sourcePath: string,
    targetPath: string,
    options?: VfsOperationOptions,
  ): Promise<void> {
    const sourceRoute = this.getRoute(sourcePath);
    const targetRoute = this.getRoute(targetPath);

    if (sourceRoute.adapter === targetRoute.adapter) {
      return sourceRoute.adapter.copyDirectory(
        sourceRoute.mappedPath,
        targetRoute.mappedPath,
        options,
      );
    }

    // Cross-adapter directory copy. We still go through copyDirectoryTree at
    // the router level so the recursion stays inside the routed namespace
    // (each entry path round-trips back to the prefixed form before recursion).
    await copyDirectoryTree(
      {
        readDirectory: (path) => this.readDirectory(path, { signal: options?.signal }),
        createDirectory: (path) => this.createDirectory(path),
        copyFile: (source, target, copyOptions) => this.copyFile(source, target, copyOptions),
      },
      sourcePath,
      targetPath,
      options,
    );
  }

  async exists(path: string): Promise<boolean> {
    const { adapter, mappedPath } = this.getRoute(path);
    return adapter.exists(mappedPath);
  }

  async getMetadata(path: string): Promise<VfsEntryMetadata | null> {
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

  async writeJson(path: string, data: unknown, options?: VfsOperationOptions): Promise<void> {
    const { adapter, mappedPath } = this.getRoute(path);
    return adapter.writeJson(mappedPath, data, options);
  }
}
