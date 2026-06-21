import type {
  IFileSystemAdapter,
  VfsEntry,
  VfsEntryMetadata,
  VfsOperationOptions,
  VfsProgressReporter,
  VfsReadDirectoryOptions,
} from './types';
import { crossVfsCopyDirectory, crossVfsCopyFile } from './crossVfs';
import { VfsNotFoundError } from './errors';

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

  private async ensureCommonDirectory(route: VfsRoute | null, path: string): Promise<void> {
    if (route && route.prefix === '@common') {
      const mappedPath = route.stripPrefix(path);
      const parts = mappedPath.split('/');
      if (parts[0] === 'common') {
        const exists = await route.adapter.exists('common');
        if (!exists) {
          await route.adapter.createDirectory('common');
        }
      }
    }
  }

  async init(): Promise<void> {
    await Promise.all([
      this.defaultAdapter.init(),
      ...this.routes.map((route) => route.adapter.init()),
    ]);
  }

  async readDirectory(path: string, options?: VfsReadDirectoryOptions): Promise<VfsEntry[]> {
    const { adapter, mappedPath, route } = this.getRoute(path);
    await this.ensureCommonDirectory(route, path);
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
    const { adapter, mappedPath, route } = this.getRoute(path);
    await this.ensureCommonDirectory(route, path);
    return adapter.createDirectory(mappedPath);
  }

  async listEntryNames(path: string): Promise<string[]> {
    const { adapter, mappedPath, route } = this.getRoute(path);
    await this.ensureCommonDirectory(route, path);
    return adapter.listEntryNames(mappedPath);
  }

  async readFile(path: string, options?: VfsOperationOptions): Promise<Blob> {
    const { adapter, mappedPath, route } = this.getRoute(path);
    await this.ensureCommonDirectory(route, path);
    return adapter.readFile(mappedPath, options);
  }

  async writeFile(
    path: string,
    data: Blob | Uint8Array | string,
    options?: VfsOperationOptions,
  ): Promise<void> {
    const { adapter, mappedPath, route } = this.getRoute(path);
    await this.ensureCommonDirectory(route, path);
    return adapter.writeFile(mappedPath, data, options);
  }

  async readStream(
    path: string,
    options?: VfsOperationOptions,
  ): Promise<ReadableStream<Uint8Array>> {
    const { adapter, mappedPath, route } = this.getRoute(path);
    await this.ensureCommonDirectory(route, path);
    return adapter.readStream(mappedPath, options);
  }

  async writeStream(
    path: string,
    options?: VfsOperationOptions,
  ): Promise<WritableStream<Uint8Array>> {
    const { adapter, mappedPath, route } = this.getRoute(path);
    await this.ensureCommonDirectory(route, path);
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

    await this.ensureCommonDirectory(sourceRoute.route, sourcePath);
    await this.ensureCommonDirectory(targetRoute.route, targetPath);

    if (sourceRoute.adapter === targetRoute.adapter) {
      return sourceRoute.adapter.moveEntry(sourceRoute.mappedPath, targetRoute.mappedPath, options);
    }

    // Cross-adapter move: copy to the exact target path then delete the source.
    // If the source is missing, surface it as a not-found error like the
    // single-adapter path does.
    const meta = await sourceRoute.adapter.getMetadata(sourceRoute.mappedPath);
    if (!meta) throw new VfsNotFoundError(sourcePath);

    if (meta.kind === 'file') {
      await crossVfsCopyFile({
        sourceVfs: sourceRoute.adapter,
        targetVfs: targetRoute.adapter,
        sourcePath: sourceRoute.mappedPath,
        targetPath: targetRoute.mappedPath,
        signal: options?.signal,
        progressReporter: this.progressReporter,
      });
    } else {
      await this.copyDirectory(sourcePath, targetPath, options);
    }

    await sourceRoute.adapter.deleteEntry(sourceRoute.mappedPath, true);
  }

  async copyFile(
    sourcePath: string,
    targetPath: string,
    options?: VfsOperationOptions,
  ): Promise<void> {
    const sourceRoute = this.getRoute(sourcePath);
    const targetRoute = this.getRoute(targetPath);

    await this.ensureCommonDirectory(sourceRoute.route, sourcePath);
    await this.ensureCommonDirectory(targetRoute.route, targetPath);

    if (sourceRoute.adapter === targetRoute.adapter) {
      return sourceRoute.adapter.copyFile(sourceRoute.mappedPath, targetRoute.mappedPath, options);
    }

    // Cross-adapter copy: honor the exact target path the caller asked for.
    // Callers that want "drop into directory, auto-pick name, sanitize" should
    // call `crossVfsCopy` directly — see the audit notes on the two flows.
    await crossVfsCopyFile({
      sourceVfs: sourceRoute.adapter,
      targetVfs: targetRoute.adapter,
      sourcePath: sourceRoute.mappedPath,
      targetPath: targetRoute.mappedPath,
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

    await this.ensureCommonDirectory(sourceRoute.route, sourcePath);
    await this.ensureCommonDirectory(targetRoute.route, targetPath);

    if (sourceRoute.adapter === targetRoute.adapter) {
      return sourceRoute.adapter.copyDirectory(
        sourceRoute.mappedPath,
        targetRoute.mappedPath,
        options,
      );
    }

    // Cross-adapter directory copy. Delegate to crossVfs so child names are
    // sanitized for the target adapter (a directory tree from a name-preserving
    // remote may contain characters that local filesystems reject).
    await crossVfsCopyDirectory({
      sourceVfs: sourceRoute.adapter,
      targetVfs: targetRoute.adapter,
      sourcePath: sourceRoute.mappedPath,
      targetPath: targetRoute.mappedPath,
      signal: options?.signal,
      progressReporter: this.progressReporter,
    });
  }

  async exists(path: string): Promise<boolean> {
    const { adapter, mappedPath } = this.getRoute(path);
    return adapter.exists(mappedPath);
  }

  async getMetadata(path: string): Promise<VfsEntryMetadata | null> {
    const { adapter, mappedPath, route } = this.getRoute(path);
    await this.ensureCommonDirectory(route, path);
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
    const { adapter, mappedPath, route } = this.getRoute(path);
    await this.ensureCommonDirectory(route, path);
    return adapter.writeJson(mappedPath, data, options);
  }
}
