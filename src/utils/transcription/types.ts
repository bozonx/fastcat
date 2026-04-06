export interface TranscriptionRequest {
  file: File | FileSystemFileHandle;
  filePath: string;
  fileName: string;
  fileType: string;
  language?: string;
  fastcatAccountApiUrl: string;
  userSettings: import('~/utils/settings').FastCatUserSettings;
  workspaceHandle: FileSystemDirectoryHandle;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

export interface TranscriptionResult {
  cacheKey: string;
  cached: boolean;
  record: import('~/repositories/transcription-cache.repository').TranscriptionCacheRecord;
}

export interface LocalTranscriptionProgress {
  status: 'decoding' | 'initializing' | 'transcribing' | 'done' | 'error';
  progress?: number;
  error?: string;
}

export interface SttWorkerInitMessage {
  type: 'init';
  id: number;
  data: { modelDirHandle: FileSystemDirectoryHandle };
}

export interface SttWorkerTranscribeMessage {
  type: 'transcribe';
  id: number;
  data: {
    audio: Float32Array;
    modelName: string;
    language?: string;
    subtask?: string;
  };
}

export interface SttWorkerProgressMessage {
  type: 'progress';
  id: number;
  data: { progress: number };
}

export interface SttWorkerResultMessage {
  type: 'result';
  id: number;
  data: unknown;
}

export interface SttWorkerErrorMessage {
  type: 'error';
  id: number;
  error: string;
}

export interface SttWorkerInitOkMessage {
  type: 'init-ok';
  id: number;
}

export interface SttWorkerPartialResultMessage {
  type: 'partial-result';
  id: number;
  data: unknown;
}

export type SttWorkerMessage = SttWorkerInitMessage | SttWorkerTranscribeMessage;

export type SttWorkerResponse =
  | SttWorkerInitOkMessage
  | SttWorkerProgressMessage
  | SttWorkerResultMessage
  | SttWorkerErrorMessage
  | SttWorkerPartialResultMessage;
