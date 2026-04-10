export type RemoteVfsScope = 'personal' | 'project';

export interface RemoteVfsMedia {
  id: string;
  name?: string;
  type: string;
  url?: string;
  mimeType?: string;
  size?: number;
  sizeBytes?: number;
  title?: string;
  filename?: string;
  posterUrl?: string;
  thumbnailUrl?: string;
  meta?: Record<string, unknown>;
  created?: string;
  updated?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface RemoteVfsMediaRelation {
  id: string;
  mediaId: string;
  order: number;
  media: RemoteVfsMedia;
}

export interface RemoteVfsProjectEntry {
  id: string;
  name: string;
  note?: string;
  createdAt?: string;
  updatedAt?: string;
  path?: string;
  type: 'project';
}

export interface RemoteVfsBaseEntry {
  id: string;
  name?: string;
  title?: string;
  type: 'file' | 'directory';
  path?: string;
  parentId?: string | null;
  created?: string;
  updated?: string;
  createdAt?: string;
  updatedAt?: string;
  meta?: Record<string, unknown>;
  scope?: RemoteVfsScope;
  projectId?: string;
}

export interface RemoteVfsDirectoryEntry extends RemoteVfsBaseEntry {
  type: 'directory';
  directItemsCount?: number;
  itemsCount?: number;
}

export interface RemoteVfsFileEntry extends RemoteVfsBaseEntry {
  type: 'file';
  text?: string;
  tags?: string[];
  language?: string;
  note?: string;
  groupId?: string | null;
  media?: (RemoteVfsMedia | RemoteVfsMediaRelation)[];
}

export interface RemoteVfsContentItem extends RemoteVfsFileEntry {}

export type RemoteVfsEntry = RemoteVfsDirectoryEntry | RemoteVfsFileEntry | RemoteVfsProjectEntry;

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
