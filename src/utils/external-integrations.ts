import type { ExternalIntegrationsSettings, GranVideoEditorUserSettings } from '~/utils/settings';

export type ExternalServiceKind = 'files' | 'stt';
export type ExternalServiceSource = 'gran_publicador' | 'manual';

export interface ResolvedExternalServiceConfig {
  source: ExternalServiceSource;
  baseUrl: string;
  bearerToken: string;
  healthUrl: string;
}

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
}): string {
  const instanceBaseUrl = getGranPublicadorInstanceBaseUrl(params.baseUrl);
  if (!instanceBaseUrl) return '';

  const url = new URL(joinUrl(instanceBaseUrl, 'integrations/connect'));
  url.searchParams.set('name', params.name.trim());
  url.searchParams.set('redirect_uri', params.redirectUri);
  return url.toString();
}

export function getGranPublicadorHealthUrl(baseUrl: string): string {
  const instanceBaseUrl = getGranPublicadorInstanceBaseUrl(baseUrl);
  return instanceBaseUrl ? joinUrl(instanceBaseUrl, 'health') : '';
}

export function getManualServiceHealthUrl(baseUrl: string): string {
  const instanceBaseUrl = getServiceInstanceBaseUrl(baseUrl);
  return instanceBaseUrl ? joinUrl(instanceBaseUrl, 'health') : '';
}

export function resolveExternalServiceConfig(params: {
  service: ExternalServiceKind;
  integrations: ExternalIntegrationsSettings;
}): ResolvedExternalServiceConfig | null {
  const { integrations, service } = params;
  const gran = integrations.granPublicador;
  const manual = service === 'files' ? integrations.manualFilesApi : integrations.manualSttApi;

  const canUseGran = gran.enabled && gran.baseUrl.trim() && gran.bearerToken.trim();
  const canUseManual = manual.enabled && manual.baseUrl.trim() && manual.bearerToken.trim();

  if (canUseManual && (!canUseGran || manual.overrideGran)) {
    return {
      source: 'manual',
      baseUrl: manual.baseUrl.trim(),
      bearerToken: manual.bearerToken.trim(),
      healthUrl: getManualServiceHealthUrl(manual.baseUrl),
    };
  }

  if (!canUseGran) return null;

  const granExternalApiBaseUrl = getGranPublicadorExternalApiBaseUrl(gran.baseUrl);
  const serviceBaseUrl =
    service === 'files'
      ? joinUrl(granExternalApiBaseUrl, 'vfs')
      : joinUrl(granExternalApiBaseUrl, 'stt');

  return {
    source: 'gran_publicador',
    baseUrl: serviceBaseUrl,
    bearerToken: gran.bearerToken.trim(),
    healthUrl: getGranPublicadorHealthUrl(gran.baseUrl),
  };
}

export function resolveExternalIntegrations(params: { userSettings: GranVideoEditorUserSettings }) {
  const { integrations } = params.userSettings;

  return {
    files: resolveExternalServiceConfig({ service: 'files', integrations }),
    stt: resolveExternalServiceConfig({ service: 'stt', integrations }),
  };
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
