export interface FileInfo {
  name: string;
  kind: 'file' | 'directory';
  size?: number;
  lastModified?: number;
  path?: string;
  metadata?: unknown;
}

export type FileAction =
  | 'createFolder'
  | 'upload'
  | 'rename'
  | 'delete'
  | 'deleteProxy'
  | 'createProxy'
  | 'cancelProxy'
  | 'openInNewTab'
  | 'createOtioVersion'
  | 'createMarkdown'
  | 'createTimeline'
  | 'createSubgroup'
  | 'createContentItem'
  | 'createProxyForFolder'
  | 'cancelProxyForFolder'
  | 'convertFile'
  | 'openAsPanel'
  | 'openAsProjectTab'
  | 'extractAudio'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'transcribe';

/** File-browser actions that are exposed in the mobile drawer/toolbar UI. */
export type MobileDrawerAction =
  | FileAction
  | 'openAsPanelCut'
  | 'openAsPanelSound'
  | 'openAsProjectTab';
