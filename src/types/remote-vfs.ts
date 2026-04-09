export interface RemoteVfsMedia {
  id: string;
  name?: string;
  type: string;
  url: string;
  mimeType?: string;
  size?: number;
  title?: string;
  filename?: string;
  posterUrl?: string;
  thumbnailUrl?: string;
  meta?: Record<string, unknown>;
  created?: string;
  updated?: string;
}

export interface RemoteVfsBaseEntry {
  id: string;
  name: string;
  title?: string;
  type: 'file' | 'directory';
  path: string;
  parentId?: string;
  created?: string;
  updated?: string;
  meta?: Record<string, unknown>;
}

export interface RemoteVfsDirectoryEntry extends RemoteVfsBaseEntry {
  type: 'directory';
  itemsCount?: number;
}

export interface RemoteVfsFileEntry extends RemoteVfsBaseEntry {
  type: 'file';
  text?: string;
  tags?: string[];
  language?: string;
  note?: string;
  media?: RemoteVfsMedia[];
}

export interface RemoteVfsContentItem extends RemoteVfsFileEntry {}

export type RemoteVfsEntry = RemoteVfsDirectoryEntry | RemoteVfsFileEntry;

export interface RemoteVfsListResponse {
  type: 'directory';
  items: RemoteVfsEntry[];
  total?: number;
}

export interface RemoteVfsHealthResponse {
  status: string;
  timestamp: string;
  user?: { id: string };
  token?: {
    id: string;
    name: string;
    scopes: string[];
    allProjects?: boolean;
    projectIds?: string[];
  };
}
