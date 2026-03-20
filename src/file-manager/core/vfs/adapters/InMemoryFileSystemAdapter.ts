import type { IFileSystemAdapter, VfsEntry } from '../types';

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
      throw new Error(`Invalid path: ${path}`);
    }
    let current = this.root;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!part) {
        throw new Error(`Invalid path segment at index ${i}: ${path}`);
      }
      let next = current.children!.get(part);
      if (!next) {
        if (options.createParent) {
          next = { name: part, kind: 'directory', lastModified: Date.now(), children: new Map() };
          current.children!.set(part, next);
        } else {
          throw new Error(`Path not found: ${path}`);
        }
      }
      if (next.kind !== 'directory') throw new Error(`Not a directory: ${part}`);
      current = next;
    }

    return { parent: current, node: current.children!.get(name), name };
  }

  async init(): Promise<void> {}

  async readDirectory(path: string): Promise<VfsEntry[]> {
    const { node } = this.resolveNode(path);
    if (!node || node.kind !== 'directory') throw new Error(`Directory not found: ${path}`);

    return Array.from(node.children!.values()).map((n) => ({
      name: n.name,
      kind: n.kind,
      path: path ? `${path}/${n.name}` : n.name,
      lastModified: n.lastModified,
      size: n.content?.size,
    }));
  }

  async createDirectory(path: string): Promise<void> {
    const { parent, node, name } = this.resolveNode(path, { createParent: true });
    if (node) {
      if (node.kind === 'directory') return;
      throw new Error(`File already exists at path: ${path}`);
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

  async readFile(path: string): Promise<Blob> {
    const { node } = this.resolveNode(path);
    if (!node || node.kind !== 'file' || !node.content) throw new Error(`File not found: ${path}`);
    return node.content;
  }

  async writeFile(path: string, data: Blob | Uint8Array | string): Promise<void> {
    const { parent, name } = this.resolveNode(path, { createParent: true });

    let blob: Blob;
    if (data instanceof Blob) {
      blob = data;
    } else if (data instanceof Uint8Array) {
      const copy = new Uint8Array(data.byteLength);
      copy.set(data);
      blob = new Blob([copy]);
    } else {
      blob = new Blob([data], { type: 'text/plain' });
    }

    parent.children!.set(name, {
      name,
      kind: 'file',
      lastModified: Date.now(),
      content: blob,
    });
  }

  async deleteEntry(path: string, recursive?: boolean): Promise<void> {
    const { parent, name, node } = this.resolveNode(path);
    if (!node) return;

    if (node.kind === 'directory' && node.children!.size > 0 && !recursive) {
      throw new Error(`Directory not empty: ${path}`);
    }

    parent.children!.delete(name);
  }

  async moveEntry(sourcePath: string, targetPath: string): Promise<void> {
    const {
      parent: sourceParent,
      name: sourceName,
      node: sourceNode,
    } = this.resolveNode(sourcePath);
    if (!sourceNode) throw new Error(`Source not found: ${sourcePath}`);

    const { parent: targetParent, name: targetName } = this.resolveNode(targetPath, {
      createParent: true,
    });

    targetParent.children!.set(targetName, {
      ...sourceNode,
      name: targetName,
      lastModified: Date.now(),
    });
    sourceParent.children!.delete(sourceName);
  }

  async copyFile(sourcePath: string, targetPath: string): Promise<void> {
    const { node: sourceNode } = this.resolveNode(sourcePath);
    if (!sourceNode || sourceNode.kind !== 'file')
      throw new Error(`Source file not found: ${sourcePath}`);

    const { parent: targetParent, name: targetName } = this.resolveNode(targetPath, {
      createParent: true,
    });
    targetParent.children!.set(targetName, {
      ...sourceNode,
      name: targetName,
      lastModified: Date.now(),
    });
  }

  async copyDirectory(sourcePath: string, targetPath: string): Promise<void> {
    throw new Error('Not implemented');
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
    const { node } = this.resolveNode(path);
    if (!node) return null;
    return {
      size: node.content?.size ?? 0,
      lastModified: node.lastModified,
      kind: node.kind,
    };
  }

  async getObjectUrl(path: string): Promise<string> {
    const blob = await this.readFile(path);
    return URL.createObjectURL(blob);
  }

  async getFile(path: string): Promise<File | null> {
    const blob = await this.readFile(path);
    const { name } = this.resolveNode(path);
    return new File([blob], name, { lastModified: Date.now() });
  }

  async writeJson(path: string, data: unknown): Promise<void> {
    await this.writeFile(path, JSON.stringify(data));
  }

  async readStream(path: string): Promise<ReadableStream<Uint8Array>> {
    const blob = await this.readFile(path);
    return blob.stream();
  }

  async writeStream(path: string): Promise<WritableStream<Uint8Array>> {
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
