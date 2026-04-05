import type { ExternalIntegrationsSettings, FastCatUserSettings } from '~/utils/settings';

export type ExternalServiceKind = 'files' | 'stt';
export type ExternalServiceSource = 'fastcat_publicador' | 'manual';
export type FastCatIntegrationScope = 'content-library:read' | 'content-library:write' | 'stt:transcribe' | 'llm:chat';

export interface ResolvedExternalServiceConfig {
  source: ExternalServiceSource;
  baseUrl: string;
  bearerToken: string;
  healthUrl: string;
}

const FILES_SCOPES: FastCatIntegrationScope[] = ['content-library:read', 'content-library:write'];
const STT_SCOPES: FastCatIntegrationScope[] = ['stt:transcribe'];

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function stripLeadingSlashes(value: string): string {
  return value.replace(/^\/+/, '');
}

export function joinUrl(baseUrl: string, path: string): string {
  const normalizedBaseUrl = trimTrailingSlashes(baseUrl.trim());
  const normalizedPath = stripLeadingSlashes(path.trim());

  if (!normalizedBaseUrl) return '';
  if (!normalizedPath) return normalizedBaseUrl;

  return `${normalizedBaseUrl}/${normalizedPath}`;
}

export function getServiceInstanceBaseUrl(baseUrl: string): string {
  const normalizedBaseUrl = trimTrailingSlashes(baseUrl.trim());
  return normalizedBaseUrl.replace(/\/api(?:\/.*)?$/i, '');
}

export function getFastCatPublicadorInstanceBaseUrl(baseUrl: string): string {
  return getServiceInstanceBaseUrl(baseUrl);
}

export function getFastCatPublicadorExternalApiBaseUrl(baseUrl: string): string {
  const instanceBaseUrl = getFastCatPublicadorInstanceBaseUrl(baseUrl);
  return instanceBaseUrl ? joinUrl(instanceBaseUrl, 'api/v1') : '';
}

export function getFastCatPublicadorConnectUrl(params: {
  uiUrl: string;
  name: string;
  redirectUri: string;
  scopes?: FastCatIntegrationScope[];
  state?: string;
}): string {
  const instanceBaseUrl = getFastCatPublicadorInstanceBaseUrl(params.uiUrl);
  if (!instanceBaseUrl) return '';

  const url = new URL(joinUrl(instanceBaseUrl, 'integrations/connect'));
  url.searchParams.set('name', params.name.trim());
  url.searchParams.set('redirect_uri', params.redirectUri);
  if (params.scopes?.length) {
    url.searchParams.set('scopes', params.scopes.join(','));
  }
  if (params.state) {
    url.searchParams.set('state', params.state);
  }
  return url.toString();
}

export function getFastCatPublicadorHealthUrl(baseUrl: string): string {
  const externalApiBaseUrl = getFastCatPublicadorExternalApiBaseUrl(baseUrl);
  return externalApiBaseUrl ? joinUrl(externalApiBaseUrl, 'external/health') : '';
}

export function getFastCatPublicadorSttStreamUrl(baseUrl: string): string {
  const externalApiBaseUrl = getFastCatPublicadorExternalApiBaseUrl(baseUrl);
  return externalApiBaseUrl ? joinUrl(externalApiBaseUrl, 'transcribe/stream') : '';
}

export function getManualServiceHealthUrl(baseUrl: string): string {
  const normalizedBaseUrl = trimTrailingSlashes(baseUrl.trim());

  if (!normalizedBaseUrl) return '';
  if (/\/health$/i.test(normalizedBaseUrl)) return normalizedBaseUrl;
  if (/\/api\/v1$/i.test(normalizedBaseUrl)) {
    return joinUrl(normalizedBaseUrl, 'health');
  }
  if (/\/api\/v1\/(vfs|stt|llm)$/i.test(normalizedBaseUrl)) {
    return normalizedBaseUrl.replace(/\/(vfs|stt|llm)$/i, '/health');
  }

  return joinUrl(normalizedBaseUrl, 'api/v1/health');
}

export function getManualSttStreamUrl(baseUrl: string): string {
  const normalizedBaseUrl = trimTrailingSlashes(baseUrl.trim());

  if (!normalizedBaseUrl) return '';
  if (/\/api\/v1\/transcribe\/stream$/i.test(normalizedBaseUrl)) return normalizedBaseUrl;
  if (/\/api\/v1\/stt$/i.test(normalizedBaseUrl)) {
    return normalizedBaseUrl.replace(/\/api\/v1\/stt$/i, '/api/v1/transcribe/stream');
  }
  if (/\/api\/v1$/i.test(normalizedBaseUrl)) {
    return joinUrl(normalizedBaseUrl, 'transcribe/stream');
  }

  return joinUrl(normalizedBaseUrl, 'api/v1/transcribe/stream');
}

export function resolveFastCatConnectScopes(params: {
  integrations: ExternalIntegrationsSettings;
  includeStt?: boolean;
}): FastCatIntegrationScope[] {
  const scopes = new Set<FastCatIntegrationScope>();

  if (
    !params.integrations.manualFilesApi.enabled ||
    !params.integrations.manualFilesApi.overrideFastCat
  ) {
    for (const scope of FILES_SCOPES) {
      scopes.add(scope);
    }
  }

  if (params.includeStt) {
    if (
      !params.integrations.manualSttApi.enabled ||
      !params.integrations.manualSttApi.overrideFastCat
    ) {
      for (const scope of STT_SCOPES) {
        scopes.add(scope);
      }
      scopes.add('llm:chat');
    }
  }

  return Array.from(scopes);
}

export function resolveExternalServiceConfig(params: {
  service: ExternalServiceKind;
  integrations: ExternalIntegrationsSettings;
  bloggerDogApiUrl: string;
  fastcatAccountApiUrl?: string;
}): ResolvedExternalServiceConfig | null {
  const { integrations, service, bloggerDogApiUrl, fastcatAccountApiUrl } = params;
  const fastcatAcc = integrations.fastcatAccount;
  const fastcatPub = integrations.fastcatPublicador;
  const manual = service === 'files' ? integrations.manualFilesApi : integrations.manualSttApi;
  const requiresBearerToken = service === 'files' || service === 'stt';

  const canUseManual =
    manual.enabled &&
    manual.baseUrl.trim() &&
    (!requiresBearerToken || Boolean(manual.bearerToken.trim()));

  const canUseFastCatAccount =
    fastcatAcc.enabled &&
    fastcatAccountApiUrl?.trim() &&
    (!requiresBearerToken || Boolean(fastcatAcc.bearerToken.trim()));

  const canUseFastCatPublicador =
    fastcatPub.enabled &&
    bloggerDogApiUrl.trim() &&
    (!requiresBearerToken || Boolean(fastcatPub.bearerToken.trim()));

  // 1. Manual always wins if enabled and manual.overrideFastCat is set
  if (canUseManual && manual.overrideFastCat) {
    return {
      source: 'manual',
      baseUrl: manual.baseUrl.trim(),
      bearerToken: manual.bearerToken.trim(),
      healthUrl: getManualServiceHealthUrl(manual.baseUrl),
    };
  }

  // 2. Fastcat Account wins next for STT if enabled (proxi stt)
  if (canUseFastCatAccount && service === 'stt') {
    const fastcatExternalApiBaseUrl = getFastCatPublicadorExternalApiBaseUrl(fastcatAccountApiUrl!);
    return {
      source: 'fastcat_publicador',
      baseUrl: joinUrl(fastcatExternalApiBaseUrl, 'external/stt'),
      bearerToken: fastcatAcc.bearerToken.trim(),
      healthUrl: getFastCatPublicadorHealthUrl(fastcatAccountApiUrl!),
    };
  }

  // 3. Fastcat Publicador (BloggerDog) next (only for files, not for stt)
  if (canUseFastCatPublicador && service === 'files') {
    const fastcatExternalApiBaseUrl = getFastCatPublicadorExternalApiBaseUrl(bloggerDogApiUrl);
    return {
      source: 'fastcat_publicador',
      baseUrl: joinUrl(fastcatExternalApiBaseUrl, 'external/content-library'),
      bearerToken: fastcatPub.bearerToken.trim(),
      healthUrl: getFastCatPublicadorHealthUrl(bloggerDogApiUrl),
    };
  }

  // 4. Manual as fallback if no fastcat configs
  if (canUseManual) {
    return {
      source: 'manual',
      baseUrl: manual.baseUrl.trim(),
      bearerToken: manual.bearerToken.trim(),
      healthUrl: getManualServiceHealthUrl(manual.baseUrl),
    };
  }

  return null;
}

export function resolveExternalIntegrations(params: {
  userSettings: FastCatUserSettings;
  bloggerDogApiUrl: string;
  fastcatAccountApiUrl: string;
}) {
  const { integrations } = params.userSettings;

  return {
    files: resolveExternalServiceConfig({
      service: 'files',
      integrations,
      bloggerDogApiUrl: params.bloggerDogApiUrl,
      fastcatAccountApiUrl: params.fastcatAccountApiUrl,
    }),
    stt: resolveExternalServiceConfig({
      service: 'stt',
      integrations,
      bloggerDogApiUrl: '', // BloggerDog removed for STT
      fastcatAccountApiUrl: params.fastcatAccountApiUrl,
    }),
  };
}

export function resolveSttStreamUrl(params: {
  userSettings: FastCatUserSettings;
  fastcatAccountApiUrl: string;
}): string {
  const resolved = resolveExternalServiceConfig({
    service: 'stt',
    integrations: params.userSettings.integrations,
    bloggerDogApiUrl: '', // BloggerDog removed for STT
    fastcatAccountApiUrl: params.fastcatAccountApiUrl,
  });

  if (!resolved) return '';

  if (resolved.source === 'manual') {
    return getManualSttStreamUrl(resolved.baseUrl);
  }

  // If not manual, it must be from Fastcat Account (since we removed BloggerDog for STT)
  return getFastCatPublicadorSttStreamUrl(params.fastcatAccountApiUrl);
}

export async function runExternalHealthCheck(params: {
  url: string;
  bearerToken: string;
}): Promise<{ ok: true; status: number; body: string }> {
  const response = await fetch(params.url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${params.bearerToken}`,
    },
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(body || `Health check failed with status ${response.status}`);
  }

  return {
    ok: true,
    status: response.status,
    body,
  };
}
