// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createDefaultUserSettings } from '~/utils/settings';
import { FASTCAT_PUBLICADOR_APP_NAME } from '~/utils/constants';
import {
  getFastCatPublicadorConnectUrl,
  getFastCatPublicadorHealthUrl,
  getFastCatPublicadorSttStreamUrl,
  getManualSttStreamUrl,
  getManualServiceHealthUrl,
  resolveExternalIntegrations,
  resolveFastCatConnectScopes,
  resolveExternalServiceConfig,
  resolveSttStreamUrl,
} from '~/utils/external-integrations';

describe('external integrations', () => {
  it('builds FastCat Publicador URLs from instance or api base URL', () => {
    expect(getFastCatPublicadorHealthUrl('https://fastcat.example.com')).toBe(
      'https://fastcat.example.com/api/v1/external/health',
    );
    expect(getFastCatPublicadorHealthUrl('https://fastcat.example.com/api/v1/external')).toBe(
      'https://fastcat.example.com/api/v1/external/health',
    );

    expect(
      getFastCatPublicadorConnectUrl({
        baseUrl: 'https://fastcat.example.com/api/v1',
        name: FASTCAT_PUBLICADOR_APP_NAME,
        redirectUri: 'http://localhost:3000/editor',
        scopes: ['vfs:read', 'stt:transcribe'],
      }),
    ).toBe(
      'https://fastcat.example.com/integrations/connect?name=FastCat&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Feditor&scopes=vfs%3Aread%2Cstt%3Atranscribe',
    );
  });

  it('builds manual health URL as /api/v1/external/health', () => {
    expect(getManualServiceHealthUrl('https://api.example.com/api/v1/external/vfs')).toBe(
      'https://api.example.com/api/v1/external/health',
    );
    expect(getManualServiceHealthUrl('https://stt.example.com')).toBe(
      'https://stt.example.com/api/v1/external/health',
    );
    expect(getManualServiceHealthUrl('https://stt.example.com/api/v1/external')).toBe(
      'https://stt.example.com/api/v1/external/health',
    );
  });

  it('builds STT stream URLs for FastCat proxy and manual gateway', () => {
    expect(getFastCatPublicadorSttStreamUrl('https://fastcat.example.com')).toBe(
      'https://fastcat.example.com/api/v1/external/api/v1/transcribe/stream',
    );

    expect(getManualSttStreamUrl('https://stt.example.com')).toBe(
      'https://stt.example.com/api/v1/transcribe/stream',
    );
    expect(getManualSttStreamUrl('https://stt.example.com/api/v1')).toBe(
      'https://stt.example.com/api/v1/transcribe/stream',
    );
    expect(getManualSttStreamUrl('https://stt.example.com/api/v1/external/stt')).toBe(
      'https://stt.example.com/api/v1/transcribe/stream',
    );
  });

  it('resolves FastCat connect scopes based on active overrides', () => {
    const integrations = createDefaultUserSettings().integrations;

    expect(resolveFastCatConnectScopes({ integrations })).toEqual(['vfs:read', 'stt:transcribe']);

    integrations.manualFilesApi.enabled = true;
    integrations.manualFilesApi.overrideFastCat = true;

    expect(resolveFastCatConnectScopes({ integrations })).toEqual(['stt:transcribe']);

    integrations.manualSttApi.enabled = true;
    integrations.manualSttApi.overrideFastCat = true;

    expect(resolveFastCatConnectScopes({ integrations })).toEqual([]);
  });

  it('prefers FastCat Publicador when manual service does not override it', () => {
    const userSettings = createDefaultUserSettings();
    userSettings.integrations.fastcatPublicador.enabled = true;
    userSettings.integrations.fastcatPublicador.bearerToken = 'gp_token';
    userSettings.integrations.manualFilesApi.enabled = true;
    userSettings.integrations.manualFilesApi.baseUrl =
      'https://files.example.com/api/v1/external/vfs';
    userSettings.integrations.manualFilesApi.bearerToken = 'files_token';
    userSettings.integrations.manualFilesApi.overrideFastCat = false;

    const resolved = resolveExternalIntegrations({
      userSettings,
      fastcatPublicadorBaseUrl: 'https://fastcat.example.com',
    });

    expect(resolved.files).toEqual({
      source: 'fastcat_publicador',
      baseUrl: 'https://fastcat.example.com/api/v1/external/vfs',
      bearerToken: 'gp_token',
      healthUrl: 'https://fastcat.example.com/api/v1/external/health',
    });
  });

  it('uses manual service when override is enabled', () => {
    const integrations = createDefaultUserSettings().integrations;
    integrations.fastcatPublicador.enabled = true;
    integrations.fastcatPublicador.bearerToken = 'gp_token';
    integrations.manualSttApi.enabled = true;
    integrations.manualSttApi.baseUrl = 'https://stt.example.com/api/v1/external/stt';
    integrations.manualSttApi.overrideFastCat = true;

    const resolved = resolveExternalServiceConfig({
      service: 'stt',
      integrations,
      fastcatPublicadorBaseUrl: 'https://fastcat.example.com',
    });

    expect(resolved).toEqual({
      source: 'manual',
      baseUrl: 'https://stt.example.com/api/v1/external/stt',
      bearerToken: '',
      healthUrl: 'https://stt.example.com/api/v1/external/health',
    });
  });

  it('resolves STT stream URL from the active provider', () => {
    const userSettings = createDefaultUserSettings();
    userSettings.integrations.manualSttApi.enabled = true;
    userSettings.integrations.manualSttApi.baseUrl = 'https://stt.example.com';
    userSettings.integrations.manualSttApi.overrideFastCat = true;

    expect(
      resolveSttStreamUrl({
        userSettings,
        fastcatPublicadorBaseUrl: 'https://fastcat.example.com',
      }),
    ).toBe('https://stt.example.com/api/v1/transcribe/stream');
  });
});
