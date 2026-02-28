export interface FileInfo {
  name: string;
  kind: 'file' | 'directory';
  size?: number;
  lastModified?: number;
  path?: string;
  metadata?: any;
}
