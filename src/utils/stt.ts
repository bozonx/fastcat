import {
  createTranscriptionCacheRepository,
  type TranscriptionCacheRecord,
} from '~/repositories/transcription-cache.repository';
import { resolveExternalServiceConfig, resolveSttStreamUrl } from '~/utils/external-integrations';
import type { FastCatUserSettings } from '~/utils/settings';
import { getMimeTypeFromFilename } from '~/utils/media-types';

export interface SttTranscriptionRequest {
  file: File | FileSystemFileHandle;
  filePath: string;
  fileName: string;
  fileType: string;
  language?: string;
  fastcatPublicadorBaseUrl: string;
  projectId: string;
  userSettings: FastCatUserSettings;
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
  const extMime = getMimeTypeFromFilename(file.name);
  if (extMime !== 'application/octet-stream') return extMime;

  if (typeof fileType === 'string' && fileType.trim()) {
    return fileType.trim().toLowerCase();
  }

  if (typeof file.type === 'string' && file.type.trim()) {
    return file.type.trim().toLowerCase();
  }

  return 'application/octet-stream';
}

function replaceFileExtension(fileName: string, extension: string): string {
  const normalizedExtension = extension.startsWith('.') ? extension : `.${extension}`;
  const trimmedFileName = fileName.trim();

  if (!trimmedFileName) {
    return `transcription${normalizedExtension}`;
  }

  const lastDotIndex = trimmedFileName.lastIndexOf('.');
  if (lastDotIndex <= 0) {
    return `${trimmedFileName}${normalizedExtension}`;
  }

  return `${trimmedFileName.slice(0, lastDotIndex)}${normalizedExtension}`;
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
  settings: FastCatUserSettings['integrations']['stt'];
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
    fastcatPublicadorBaseUrl: input.fastcatPublicadorBaseUrl,
  });
  const endpoint = resolveSttStreamUrl({
    userSettings: input.userSettings,
    fastcatPublicadorBaseUrl: input.fastcatPublicadorBaseUrl,
  });

  if (!resolvedConfig || !endpoint) {
    throw new Error('STT integration is not configured');
  }

  const file = input.file instanceof File ? input.file : await input.file.getFile();
  const language = normalizeLanguage(input.language);
  const provider = normalizeProvider(input.userSettings.integrations.stt.provider);
  const models = normalizeModels(input.userSettings.integrations.stt.models);
  const normalizedFileType = normalizeFileType(input.fileType, file);
  const requestFileName = normalizedFileType.startsWith('video/')
    ? replaceFileExtension(input.fileName, 'wav')
    : input.fileName;
  const cacheKey = await createCacheKey({
    filePath: input.filePath,
    fileName: requestFileName,
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

  // Send the original file directly to STT without local WAV extraction.
  // Modern STT services (e.g. Whisper) can extract audio from video containers natively.
  // This avoids OOM crashes, UI freezes, and 'failed to fetch' caused by chunked requests or giant Blobs.
  const body: BodyInit = file;
  const contentType = normalizedFileType;

  const headers = createRequestHeaders({
    file,
    fileName: requestFileName,
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
