import type { FileAction } from '~/composables/file-manager/useFileManagerActions';

export interface FileInfo {
  name: string;
  kind: 'file' | 'directory';
  size?: number;
  lastModified?: number;
  path?: string;
  metadata?: unknown;
}

/** File-browser actions that are exposed in the mobile drawer/toolbar UI. */
export type MobileDrawerAction =
  | FileAction
  | 'openAsPanelCut'
  | 'openAsPanelSound'
  | 'openAsProjectTab';
