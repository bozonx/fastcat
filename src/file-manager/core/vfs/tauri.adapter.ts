import type { IFileSystemAdapter, VfsEntry } from './types';

export class TauriFileSystemAdapter implements IFileSystemAdapter {
  id = 'tauri';
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  async init(): Promise<void> {
    // Check if running in Tauri environment
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
      throw new Error('Not running in Tauri environment');
    }
    // E.g. create base app data dir if not exists
  }

  async readDirectory(path: string): Promise<VfsEntry[]> {
    throw new Error('Method not implemented.');
  }

  async createDirectory(path: string): Promise<void> {
    throw new Error('Method not implemented.');
  }

  async readFile(path: string): Promise<Blob> {
    throw new Error('Method not implemented.');
  }

  async writeFile(path: string, data: Blob | Uint8Array | string): Promise<void> {
    throw new Error('Method not implemented.');
  }

  async deleteEntry(path: string, recursive?: boolean): Promise<void> {
    throw new Error('Method not implemented.');
  }

  async moveEntry(sourcePath: string, targetPath: string): Promise<void> {
    throw new Error('Method not implemented.');
  }

  async exists(path: string): Promise<boolean> {
    throw new Error('Method not implemented.');
  }

  async getMetadata(
    path: string,
  ): Promise<{ size: number; lastModified: number; kind: 'file' | 'directory' } | null> {
    throw new Error('Method not implemented.');
  }

  async getObjectUrl(path: string): Promise<string> {
    throw new Error('Method not implemented.');
  }
}
