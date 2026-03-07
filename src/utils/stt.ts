import {
  createTranscriptionCacheRepository,
  type TranscriptionCacheRecord,
} from '~/repositories/transcription-cache.repository';
import { resolveExternalServiceConfig, resolveSttStreamUrl } from '~/utils/external-integrations';
import type { GranVideoEditorUserSettings } from '~/utils/settings';

export interface SttTranscriptionRequest {
  fileHandle: FileSystemFileHandle;
  filePath: string;
  fileName: string;
  fileType: string;
  language?: string;
  granPublicadorBaseUrl: string;
  projectId: string;
  userSettings: GranVideoEditorUserSettings;
  workspaceHandle: FileSystemDirectoryHandle;
}

export interface SttTranscriptionResult {
  cacheKey: string;
  cached: boolean;
  record: TranscriptionCacheRecord;
}

function normalizeLanguage(language?: string): string {
  return typeof language === 'string' ? language.trim() : '';
}

function normalizeProvider(provider: string): string {
  return provider.trim();
}

function normalizeModels(models: string[]): string[] {
  return models.map((model) => model.trim()).filter(Boolean);
}

function normalizeFileType(fileType: string | undefined, file: File): string {
  if (typeof fileType === 'string' && fileType.trim()) {
    return fileType.trim().toLowerCase();
  }

  if (typeof file.type === 'string' && file.type.trim()) {
    return file.type.trim().toLowerCase();
  }

  return 'application/octet-stream';
}

async function createCacheKey(params: {
  filePath: string;
  fileName: string;
  fileSize: number;
  lastModified: number;
  language: string;
  provider: string;
  models: string[];
  endpoint: string;
}): Promise<string> {
  const payload = JSON.stringify(params);
  const encoded = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function createRequestHeaders(params: {
  file: File | null;
  fileName: string;
  language: string;
  provider: string;
  models: string[];
  bearerToken: string;
  settings: GranVideoEditorUserSettings['integrations']['stt'];
  contentType?: string;
}): Headers {
  const headers = new Headers();
  headers.set(
    'Content-Type',
    params.contentType || params.file?.type || 'application/octet-stream',
  );
  headers.set('X-File-Name', params.fileName);
  headers.set('X-STT-Restore-Punctuation', String(params.settings.restorePunctuation));
  headers.set('X-STT-Format-Text', String(params.settings.formatText));
  headers.set('X-STT-Include-Words', String(params.settings.includeWords));

  if (params.bearerToken) {
    headers.set('Authorization', `Bearer ${params.bearerToken}`);
  }

  if (params.provider) {
    headers.set('X-STT-Provider', params.provider);
  }

  if (params.language) {
    headers.set('X-STT-Language', params.language);
  }

  if (params.models.length > 0) {
    headers.set('X-STT-Models', params.models.join(','));
  }

  return headers;
}

export async function transcribeProjectAudioFile(
  input: SttTranscriptionRequest,
): Promise<SttTranscriptionResult> {
  const resolvedConfig = resolveExternalServiceConfig({
    service: 'stt',
    integrations: input.userSettings.integrations,
    granPublicadorBaseUrl: input.granPublicadorBaseUrl,
  });
  const endpoint = resolveSttStreamUrl({
    userSettings: input.userSettings,
    granPublicadorBaseUrl: input.granPublicadorBaseUrl,
  });

  if (!resolvedConfig || !endpoint) {
    throw new Error('STT integration is not configured');
  }

  const file = await input.fileHandle.getFile();
  const language = normalizeLanguage(input.language);
  const provider = normalizeProvider(input.userSettings.integrations.stt.provider);
  const models = normalizeModels(input.userSettings.integrations.stt.models);
  const normalizedFileType = normalizeFileType(input.fileType, file);
  const cacheKey = await createCacheKey({
    filePath: input.filePath,
    fileName: input.fileName,
    fileSize: file.size,
    lastModified: file.lastModified,
    language,
    provider,
    models,
    endpoint,
  });

  const cacheRepository = createTranscriptionCacheRepository({
    workspaceDir: input.workspaceHandle,
    projectId: input.projectId,
  });
  const cachedRecord = await cacheRepository.load(cacheKey);
  if (cachedRecord) {
    return {
      cacheKey,
      cached: true,
      record: cachedRecord,
    };
  }

  let body: BodyInit;
  let contentType: string | undefined;

  if (normalizedFileType.startsWith('video/')) {
    const { createAudioStreamFromFile } = await import('~/utils/audio-streaming');
    const { stream } = await createAudioStreamFromFile(file);
    body = stream as any;
    contentType = 'audio/wav';
  } else {
    body = file;
  }

  const headers = createRequestHeaders({
    file,
    fileName: input.fileName,
    language,
    provider,
    models,
    bearerToken: resolvedConfig.bearerToken,
    settings: input.userSettings.integrations.stt,
    contentType,
  });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body,
    // @ts-expect-error - duplex is required for streaming body
    duplex: body instanceof ReadableStream ? 'half' : undefined,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `STT request failed (${response.status})`);
  }

  const responsePayload = (await response.json()) as unknown;
  const record: TranscriptionCacheRecord = {
    key: cacheKey,
    createdAt: new Date().toISOString(),
    sourcePath: input.filePath,
    sourceName: input.fileName,
    sourceSize: file.size,
    sourceLastModified: file.lastModified,
    language,
    provider,
    models,
    response: responsePayload,
  };

  await cacheRepository.save(record);

  return {
    cacheKey,
    cached: false,
    record,
  };
}
