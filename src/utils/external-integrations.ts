import type { ExternalIntegrationsSettings, FastCatUserSettings } from '~/utils/settings';

export type ExternalServiceKind = 'files' | 'stt';
export type ExternalServiceSource = 'fastcat_publicador' | 'manual';
export type FastCatIntegrationScope = 'vfs:read' | 'vfs:write' | 'stt:transcribe' | 'llm:chat';

export interface ResolvedExternalServiceConfig {
  source: ExternalServiceSource;
  baseUrl: string;
  bearerToken: string;
  healthUrl: string;
}

const FILES_SCOPES: FastCatIntegrationScope[] = ['vfs:read', 'vfs:write'];
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
  return instanceBaseUrl ? joinUrl(instanceBaseUrl, 'api/v1/external') : '';
}

export function getFastCatPublicadorConnectUrl(params: {
  baseUrl: string;
  name: string;
  redirectUri: string;
  scopes?: FastCatIntegrationScope[];
}): string {
  const instanceBaseUrl = getFastCatPublicadorInstanceBaseUrl(params.baseUrl);
  if (!instanceBaseUrl) return '';

  const url = new URL(joinUrl(instanceBaseUrl, 'integrations/connect'));
  url.searchParams.set('name', params.name.trim());
  url.searchParams.set('redirect_uri', params.redirectUri);
  if (params.scopes?.length) {
    url.searchParams.set('scopes', params.scopes.join(','));
  }
  return url.toString();
}

export function getFastCatPublicadorHealthUrl(baseUrl: string): string {
  const externalApiBaseUrl = getFastCatPublicadorExternalApiBaseUrl(baseUrl);
  return externalApiBaseUrl ? joinUrl(externalApiBaseUrl, 'health') : '';
}

export function getFastCatPublicadorSttStreamUrl(baseUrl: string): string {
  const externalApiBaseUrl = getFastCatPublicadorExternalApiBaseUrl(baseUrl);
  return externalApiBaseUrl ? joinUrl(externalApiBaseUrl, 'api/v1/transcribe/stream') : '';
}

export function getManualServiceHealthUrl(baseUrl: string): string {
  const normalizedBaseUrl = trimTrailingSlashes(baseUrl.trim());

  if (!normalizedBaseUrl) return '';
  if (/\/health$/i.test(normalizedBaseUrl)) return normalizedBaseUrl;
  if (/\/api\/v1\/external$/i.test(normalizedBaseUrl)) {
    return joinUrl(normalizedBaseUrl, 'health');
  }
  if (/\/api\/v1\/external\/(vfs|stt|llm)$/i.test(normalizedBaseUrl)) {
    return normalizedBaseUrl.replace(/\/(vfs|stt|llm)$/i, '/health');
  }

  return joinUrl(normalizedBaseUrl, 'api/v1/external/health');
}

export function getManualSttStreamUrl(baseUrl: string): string {
  const normalizedBaseUrl = trimTrailingSlashes(baseUrl.trim());

  if (!normalizedBaseUrl) return '';
  if (/\/api\/v1\/transcribe\/stream$/i.test(normalizedBaseUrl)) return normalizedBaseUrl;
  if (/\/api\/v1\/external\/stt$/i.test(normalizedBaseUrl)) {
    return normalizedBaseUrl.replace(/\/api\/v1\/external\/stt$/i, '/api/v1/transcribe/stream');
  }
  if (/\/api\/v1$/i.test(normalizedBaseUrl)) {
    return joinUrl(normalizedBaseUrl, 'transcribe/stream');
  }

  return joinUrl(normalizedBaseUrl, 'api/v1/transcribe/stream');
}

export function resolveFastCatConnectScopes(params: {
  integrations: ExternalIntegrationsSettings;
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

  if (
    !params.integrations.manualSttApi.enabled ||
    !params.integrations.manualSttApi.overrideFastCat
  ) {
    for (const scope of STT_SCOPES) {
      scopes.add(scope);
    }

    scopes.add('llm:chat');
  }

  return Array.from(scopes);
}

export function resolveExternalServiceConfig(params: {
  service: ExternalServiceKind;
  integrations: ExternalIntegrationsSettings;
  fastcatPublicadorBaseUrl: string;
}): ResolvedExternalServiceConfig | null {
  const { integrations, service, fastcatPublicadorBaseUrl } = params;
  const fastcat = integrations.fastcatPublicador;
  const manual = service === 'files' ? integrations.manualFilesApi : integrations.manualSttApi;
  const requiresBearerToken = service === 'files' || service === 'stt';

  const canUseFastCat =
    fastcat.enabled &&
    fastcatPublicadorBaseUrl.trim() &&
    (!requiresBearerToken || Boolean(fastcat.bearerToken.trim()));
  const canUseManual =
    manual.enabled &&
    manual.baseUrl.trim() &&
    (!requiresBearerToken || Boolean(manual.bearerToken.trim()));

  if (canUseManual && (!canUseFastCat || manual.overrideFastCat)) {
    return {
      source: 'manual',
      baseUrl: manual.baseUrl.trim(),
      bearerToken: manual.bearerToken.trim(),
      healthUrl: getManualServiceHealthUrl(manual.baseUrl),
    };
  }

  if (!canUseFastCat) return null;

  const fastcatExternalApiBaseUrl =
    getFastCatPublicadorExternalApiBaseUrl(fastcatPublicadorBaseUrl);
  const serviceBaseUrl =
    service === 'files'
      ? joinUrl(fastcatExternalApiBaseUrl, 'vfs')
      : joinUrl(fastcatExternalApiBaseUrl, 'stt');

  return {
    source: 'fastcat_publicador',
    baseUrl: serviceBaseUrl,
    bearerToken: fastcat.bearerToken.trim(),
    healthUrl: getFastCatPublicadorHealthUrl(fastcatPublicadorBaseUrl),
  };
}

export function resolveExternalIntegrations(params: {
  userSettings: FastCatUserSettings;
  fastcatPublicadorBaseUrl: string;
}) {
  const { integrations } = params.userSettings;

  return {
    files: resolveExternalServiceConfig({
      service: 'files',
      integrations,
      fastcatPublicadorBaseUrl: params.fastcatPublicadorBaseUrl,
    }),
    stt: resolveExternalServiceConfig({
      service: 'stt',
      integrations,
      fastcatPublicadorBaseUrl: params.fastcatPublicadorBaseUrl,
    }),
  };
}

export function resolveSttStreamUrl(params: {
  userSettings: FastCatUserSettings;
  fastcatPublicadorBaseUrl: string;
}): string {
  const resolved = resolveExternalServiceConfig({
    service: 'stt',
    integrations: params.userSettings.integrations,
    fastcatPublicadorBaseUrl: params.fastcatPublicadorBaseUrl,
  });

  if (!resolved) return '';

  return resolved.source === 'fastcat_publicador'
    ? getFastCatPublicadorSttStreamUrl(params.fastcatPublicadorBaseUrl)
    : getManualSttStreamUrl(resolved.baseUrl);
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
