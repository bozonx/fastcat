export interface RemoteVfsMedia {
  id: string;
  name?: string;
  type: string;
  url: string;
  mimeType?: string;
  size?: number;
  title?: string;
  posterUrl?: string;
  thumbnailUrl?: string;
  meta?: Record<string, unknown>;
}

export interface RemoteVfsBaseEntry {
  id: string;
  name: string;
  title?: string;
  type: 'file' | 'directory';
  path: string;
  parentId?: string;
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
  meta?: Record<string, unknown>;
  media?: RemoteVfsMedia[];
}

export interface RemoteVfsContentItem extends RemoteVfsFileEntry {}

export type RemoteVfsEntry = RemoteVfsDirectoryEntry | RemoteVfsFileEntry;

export interface RemoteVfsListResponse {
  type: 'directory';
  items: RemoteVfsEntry[];
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
