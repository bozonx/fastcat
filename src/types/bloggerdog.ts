import type { RemoteVfsEntry } from './remote-vfs';

export type BdEntryType = 'content-item' | 'collection' | 'media' | 'project' | 'virtual-folder';

export interface BloggerDogEntryPayload {
  type: BdEntryType;
  thumbnailUrl?: string;
  remoteData: RemoteVfsEntry;
  mediaId?: string;
}

export interface BdCollection {
  id: string;
  name: string;
  title?: string;
  path: string;
  parentId?: string;
  itemsCount?: number;
  updatedAt?: string;
}

export interface BdContentItem {
  id: string;
  name: string;
  title?: string;
  path: string;
  parentId?: string;
  text?: string;
  tags?: string[];
  language?: string;
  note?: string;
  media?: BdMedia[];
  meta?: Record<string, unknown>;
  updatedAt?: string;
}

export interface BdMedia {
  id: string;
  name?: string;
  type: string;
  url: string;
  mimeType?: string;
  size?: number;
  title?: string;
  filename?: string;
  thumbnailUrl?: string;
  meta?: Record<string, unknown>;
}

export interface BdPagination {
  total: number;
  limit: number;
  offset: number;
}

export interface BdState {
  collections: Map<string, BdCollection>;
  items: Map<string, BdContentItem>;
  currentPath: string;
  currentEntries: RemoteVfsEntry[];
  pagination: BdPagination;
  isLoading: boolean;
  error: string | null;
}

export function getBdPayload(entry: {
  adapterPayload?: unknown;
}): BloggerDogEntryPayload | undefined {
  return entry.adapterPayload as BloggerDogEntryPayload | undefined;
}
