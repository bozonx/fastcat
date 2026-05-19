import type { IFileSystemAdapter, VfsEntry, VfsOperationOptions } from '../types';
import {
  VfsConflictError,
  VfsInvalidArgumentError,
  VfsNotFoundError,
  throwIfAborted,
} from '../errors';

interface InMemoryNode {
  name: string;
  kind: 'file' | 'directory';
  lastModified: number;
  content?: Blob;
  children?: Map<string, InMemoryNode>;
}

export class InMemoryFileSystemAdapter implements IFileSystemAdapter {
  id = 'in-memory';
  private root: InMemoryNode = {
    name: 'root',
    kind: 'directory',
    lastModified: Date.now(),
    children: new Map(),
  };
  private objectUrls = new Map<string, string>();

  private resolveNode(
    path: string,
    options: { createParent?: boolean } = {},
  ): { parent: InMemoryNode; node: InMemoryNode | undefined; name: string } {
    const parts = path.split('/').filter(Boolean);
    if (parts.length === 0) {
      return { parent: this.root, node: this.root, name: 'root' };
    }

    const name = parts[parts.length - 1];
    if (!name) {
      throw new VfsInvalidArgumentError(`Invalid path: ${path}`, { path });
    }
    let current = this.root;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!part) {
        throw new VfsInvalidArgumentError(`Invalid path segment at index ${i}: ${path}`, { path });
      }
      let next = current.children!.get(part);
      if (!next) {
        if (options.createParent) {
          next = { name: part, kind: 'directory', lastModified: Date.now(), children: new Map() };
          current.children!.set(part, next);
        } else {
          throw new VfsNotFoundError(path);
        }
      }
      if (next.kind !== 'directory')
        throw new VfsConflictError(path, `Not a directory: ${part}`);
      current = next;
    }

    return { parent: current, node: current.children!.get(name), name };
  }

  async init(): Promise<void> {}

  async readDirectory(path: string, options?: VfsOperationOptions): Promise<VfsEntry[]> {
    throwIfAborted(options?.signal, path);
    let resolved: ReturnType<typeof this.resolveNode>;
    try {
      resolved = this.resolveNode(path);
    } catch (e) {
      // Match other adapters: missing intermediate segments resolve as "no entries".
      if (e instanceof VfsNotFoundError) return [];
      throw e;
    }
    const { node } = resolved;
    if (!node) return [];
    if (node.kind !== 'directory') throw new VfsConflictError(path, `Not a directory: ${path}`);

    return Array.from(node.children!.values()).map((n) => ({
      name: n.name,
      kind: n.kind,
      path: path ? `${path}/${n.name}` : n.name,
      parentPath: path || undefined,
      lastModified: n.lastModified,
      size: n.content?.size,
    }));
  }

  async createDirectory(path: string): Promise<void> {
    const { parent, node, name } = this.resolveNode(path, { createParent: true });
    if (node) {
      if (node.kind === 'directory') return;
      throw new VfsConflictError(path, `File already exists at path: ${path}`);
    }
    parent.children!.set(name, {
      name,
      kind: 'directory',
      lastModified: Date.now(),
      children: new Map(),
    });
  }

  async listEntryNames(path: string): Promise<string[]> {
    const { node } = this.resolveNode(path);
    if (!node || node.kind !== 'directory') return [];
    return Array.from(node.children!.keys());
  }

  async readFile(path: string, options?: VfsOperationOptions): Promise<Blob> {
    throwIfAborted(options?.signal, path);
    const { node } = this.resolveNode(path);
    if (!node || node.kind !== 'file' || !node.content) throw new VfsNotFoundError(path);
    return node.content;
  }

  async writeFile(
    path: string,
    data: Blob | Uint8Array | string,
    options?: VfsOperationOptions,
  ): Promise<void> {
    throwIfAborted(options?.signal, path);
    const { parent, name } = this.resolveNode(path, { createParent: true });

    let blob: Blob;
    if (data instanceof Blob) {
      blob = data;
    } else if (data instanceof Uint8Array) {
      const copy = new Uint8Array(data.byteLength);
      copy.set(data);
      blob = new Blob([copy]);
    } else {
      // Don't assume the string is text/plain — JSON, XML and other formats
      // pass through here. An untyped Blob keeps consumers from making the
      // wrong assumption based on the MIME type.
      blob = new Blob([data]);
    }

    this.revokeObjectUrl(path);
    parent.children!.set(name, {
      name,
      kind: 'file',
      lastModified: Date.now(),
      content: blob,
    });
  }

  async deleteEntry(path: string, recursive?: boolean): Promise<void> {
    let resolved: ReturnType<typeof this.resolveNode>;
    try {
      resolved = this.resolveNode(path);
    } catch (e) {
      // Missing paths resolve silently per IFileSystemAdapter contract.
      if (e instanceof VfsNotFoundError) return;
      throw e;
    }
    const { parent, name, node } = resolved;
    if (!node) return;

    if (node.kind === 'directory' && node.children!.size > 0 && !recursive) {
      throw new VfsConflictError(path, `Directory not empty: ${path}`);
    }

    this.revokeObjectUrl(path);
    parent.children!.delete(name);
  }

  async moveEntry(
    sourcePath: string,
    targetPath: string,
    options?: VfsOperationOptions,
  ): Promise<void> {
    throwIfAborted(options?.signal, sourcePath);
    const {
      parent: sourceParent,
      name: sourceName,
      node: sourceNode,
    } = this.resolveNode(sourcePath);
    if (!sourceNode) throw new VfsNotFoundError(sourcePath);

    const {
      parent: targetParent,
      name: targetName,
      node: existingTarget,
    } = this.resolveNode(targetPath, { createParent: true });
    if (existingTarget && existingTarget !== sourceNode) {
      throw new VfsConflictError(targetPath, `Target already exists: ${targetPath}`);
    }

    this.revokeObjectUrl(sourcePath);
    targetParent.children!.set(targetName, {
      ...sourceNode,
      name: targetName,
      lastModified: Date.now(),
    });
    sourceParent.children!.delete(sourceName);
  }

  async copyFile(
    sourcePath: string,
    targetPath: string,
    options?: VfsOperationOptions,
  ): Promise<void> {
    throwIfAborted(options?.signal, sourcePath);
    const { node: sourceNode } = this.resolveNode(sourcePath);
    if (!sourceNode || sourceNode.kind !== 'file') throw new VfsNotFoundError(sourcePath);

    const { parent: targetParent, name: targetName } = this.resolveNode(targetPath, {
      createParent: true,
    });
    targetParent.children!.set(targetName, {
      ...sourceNode,
      name: targetName,
      lastModified: Date.now(),
    });
  }

  async copyDirectory(
    sourcePath: string,
    targetPath: string,
    options?: VfsOperationOptions,
  ): Promise<void> {
    throwIfAborted(options?.signal, sourcePath);
    const { node: sourceNode } = this.resolveNode(sourcePath);
    if (!sourceNode || sourceNode.kind !== 'directory') {
      throw new VfsNotFoundError(sourcePath);
    }

    await this.createDirectory(targetPath);

    for (const child of sourceNode.children!.values()) {
      throwIfAborted(options?.signal, sourcePath);
      const childSource = sourcePath ? `${sourcePath}/${child.name}` : child.name;
      const childTarget = targetPath ? `${targetPath}/${child.name}` : child.name;
      if (child.kind === 'directory') {
        await this.copyDirectory(childSource, childTarget, options);
      } else {
        await this.copyFile(childSource, childTarget, options);
      }
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      const { node } = this.resolveNode(path);
      return !!node;
    } catch {
      return false;
    }
  }

  async getMetadata(path: string) {
    let resolved: ReturnType<typeof this.resolveNode>;
    try {
      resolved = this.resolveNode(path);
    } catch (e) {
      if (e instanceof VfsNotFoundError) return null;
      throw e;
    }
    const { node } = resolved;
    if (!node) return null;
    return {
      size: node.content?.size ?? 0,
      lastModified: node.lastModified,
      kind: node.kind,
    };
  }

  async getObjectUrl(path: string): Promise<string> {
    const blob = await this.readFile(path);
    this.revokeObjectUrl(path);
    const url = URL.createObjectURL(blob);
    this.objectUrls.set(path, url);
    return url;
  }

  private revokeObjectUrl(path: string): void {
    const existing = this.objectUrls.get(path);
    if (existing) {
      URL.revokeObjectURL(existing);
      this.objectUrls.delete(path);
    }
  }

  async getFile(path: string): Promise<File | null> {
    const { node, name } = this.resolveNode(path);
    if (!node || node.kind !== 'file' || !node.content) return null;
    return new File([node.content], name, { lastModified: node.lastModified });
  }

  async writeJson(path: string, data: unknown, options?: VfsOperationOptions): Promise<void> {
    await this.writeFile(path, JSON.stringify(data), options);
  }

  async readStream(path: string, options?: VfsOperationOptions): Promise<ReadableStream<Uint8Array>> {
    const blob = await this.readFile(path, options);
    return blob.stream();
  }

  async writeStream(
    path: string,
    options?: VfsOperationOptions,
  ): Promise<WritableStream<Uint8Array>> {
    throwIfAborted(options?.signal, path);
    const chunks: Uint8Array[] = [];
    return new WritableStream({
      write: (chunk) => {
        chunks.push(chunk);
      },
      close: async () => {
        const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
        const merged = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }
        await this.writeFile(path, merged);
      },
    });
  }
}
