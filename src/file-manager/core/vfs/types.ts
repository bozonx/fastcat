export interface VfsEntry {
  name: string;
  kind: 'file' | 'directory';
  path: string;
  lastModified?: number;
  size?: number;
  children?: VfsEntry[];
  expanded?: boolean;
}

export interface IFileSystemAdapter {
  id: string;

  /**
   * Initializes the adapter (e.g. requests permissions, opens root handle)
   */
  init(): Promise<void>;

  /**
   * Reads a directory and returns its children entries
   */
  readDirectory(path: string): Promise<VfsEntry[]>;

  /**
   * Creates a directory at the given path
   */
  createDirectory(path: string): Promise<void>;

  /**
   * Reads file contents as a Blob
   */
  readFile(path: string): Promise<Blob>;

  /**
   * Writes data to a file
   */
  writeFile(path: string, data: Blob | Uint8Array | string): Promise<void>;

  /**
   * Deletes a file or directory
   * @param recursive if true, deletes directories with their contents
   */
  deleteEntry(path: string, recursive?: boolean): Promise<void>;

  /**
   * Renames/moves an entry
   */
  moveEntry(sourcePath: string, targetPath: string): Promise<void>;

  /**
   * Checks if an entry exists
   */
  exists(path: string): Promise<boolean>;

  /**
   * Get metadata for an entry
   */
  getMetadata(path: string): Promise<{ size: number; lastModified: number; kind: 'file' | 'directory' } | null>;

  /**
   * Get an object URL for a file (useful for media playback)
   */
  getObjectUrl(path: string): Promise<string>;

  /**
   * Resolve a real file for a path (if supported)
   * This is needed because some parts of the app (like media conversion) might still need File objects.
   */
  getFile?(path: string): Promise<File | null>;
}
