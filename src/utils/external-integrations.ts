import type { ExternalIntegrationsSettings, GranVideoEditorUserSettings } from '~/utils/settings';

export type ExternalServiceKind = 'files' | 'stt';
export type ExternalServiceSource = 'gran_publicador' | 'manual';
export type GranIntegrationScope = 'vfs:read' | 'vfs:write' | 'stt:transcribe' | 'llm:chat';

export interface ResolvedExternalServiceConfig {
  source: ExternalServiceSource;
  baseUrl: string;
  bearerToken: string;
  healthUrl: string;
}

const FILES_SCOPES: GranIntegrationScope[] = ['vfs:read'];
const STT_SCOPES: GranIntegrationScope[] = ['stt:transcribe'];

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

export function getGranPublicadorInstanceBaseUrl(baseUrl: string): string {
  return getServiceInstanceBaseUrl(baseUrl);
}

export function getGranPublicadorExternalApiBaseUrl(baseUrl: string): string {
  const instanceBaseUrl = getGranPublicadorInstanceBaseUrl(baseUrl);
  return instanceBaseUrl ? joinUrl(instanceBaseUrl, 'api/v1/external') : '';
}

export function getGranPublicadorConnectUrl(params: {
  baseUrl: string;
  name: string;
  redirectUri: string;
  scopes?: GranIntegrationScope[];
}): string {
  const instanceBaseUrl = getGranPublicadorInstanceBaseUrl(params.baseUrl);
  if (!instanceBaseUrl) return '';

  const url = new URL(joinUrl(instanceBaseUrl, 'integrations/connect'));
  url.searchParams.set('name', params.name.trim());
  url.searchParams.set('redirect_uri', params.redirectUri);
  if (params.scopes?.length) {
    url.searchParams.set('scopes', params.scopes.join(','));
  }
  return url.toString();
}

export function getGranPublicadorHealthUrl(baseUrl: string): string {
  const externalApiBaseUrl = getGranPublicadorExternalApiBaseUrl(baseUrl);
  return externalApiBaseUrl ? joinUrl(externalApiBaseUrl, 'health') : '';
}

export function getGranPublicadorSttStreamUrl(baseUrl: string): string {
  const externalApiBaseUrl = getGranPublicadorExternalApiBaseUrl(baseUrl);
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

export function resolveGranConnectScopes(params: {
  integrations: ExternalIntegrationsSettings;
}): GranIntegrationScope[] {
  const scopes = new Set<GranIntegrationScope>();

  if (
    !params.integrations.manualFilesApi.enabled ||
    !params.integrations.manualFilesApi.overrideGran
  ) {
    for (const scope of FILES_SCOPES) {
      scopes.add(scope);
    }
  }

  if (!params.integrations.manualSttApi.enabled || !params.integrations.manualSttApi.overrideGran) {
    for (const scope of STT_SCOPES) {
      scopes.add(scope);
    }
  }

  return Array.from(scopes);
}

export function resolveExternalServiceConfig(params: {
  service: ExternalServiceKind;
  integrations: ExternalIntegrationsSettings;
  granPublicadorBaseUrl: string;
}): ResolvedExternalServiceConfig | null {
  const { integrations, service, granPublicadorBaseUrl } = params;
  const gran = integrations.granPublicador;
  const manual = service === 'files' ? integrations.manualFilesApi : integrations.manualSttApi;
  const requiresBearerToken = service === 'files';

  const canUseGran =
    gran.enabled &&
    granPublicadorBaseUrl.trim() &&
    (!requiresBearerToken || Boolean(gran.bearerToken.trim()));
  const canUseManual =
    manual.enabled &&
    manual.baseUrl.trim() &&
    (!requiresBearerToken || Boolean(manual.bearerToken.trim()));

  if (canUseManual && (!canUseGran || manual.overrideGran)) {
    return {
      source: 'manual',
      baseUrl: manual.baseUrl.trim(),
      bearerToken: manual.bearerToken.trim(),
      healthUrl: getManualServiceHealthUrl(manual.baseUrl),
    };
  }

  if (!canUseGran) return null;

  const granExternalApiBaseUrl = getGranPublicadorExternalApiBaseUrl(granPublicadorBaseUrl);
  const serviceBaseUrl =
    service === 'files'
      ? joinUrl(granExternalApiBaseUrl, 'vfs')
      : joinUrl(granExternalApiBaseUrl, 'stt');

  return {
    source: 'gran_publicador',
    baseUrl: serviceBaseUrl,
    bearerToken: gran.bearerToken.trim(),
    healthUrl: getGranPublicadorHealthUrl(granPublicadorBaseUrl),
  };
}

export function resolveExternalIntegrations(params: {
  userSettings: GranVideoEditorUserSettings;
  granPublicadorBaseUrl: string;
}) {
  const { integrations } = params.userSettings;

  return {
    files: resolveExternalServiceConfig({
      service: 'files',
      integrations,
      granPublicadorBaseUrl: params.granPublicadorBaseUrl,
    }),
    stt: resolveExternalServiceConfig({
      service: 'stt',
      integrations,
      granPublicadorBaseUrl: params.granPublicadorBaseUrl,
    }),
  };
}

export function resolveSttStreamUrl(params: {
  userSettings: GranVideoEditorUserSettings;
  granPublicadorBaseUrl: string;
}): string {
  const resolved = resolveExternalServiceConfig({
    service: 'stt',
    integrations: params.userSettings.integrations,
    granPublicadorBaseUrl: params.granPublicadorBaseUrl,
  });

  if (!resolved) return '';

  return resolved.source === 'gran_publicador'
    ? getGranPublicadorSttStreamUrl(params.granPublicadorBaseUrl)
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
