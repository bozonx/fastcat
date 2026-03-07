// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createDefaultUserSettings } from '../../src/utils/settings';
import { GRAN_PUBLICADOR_APP_NAME } from '../../src/utils/constants';
import {
  getGranPublicadorConnectUrl,
  getGranPublicadorHealthUrl,
  getGranPublicadorSttStreamUrl,
  getManualSttStreamUrl,
  getManualServiceHealthUrl,
  resolveExternalIntegrations,
  resolveGranConnectScopes,
  resolveExternalServiceConfig,
  resolveSttStreamUrl,
} from '../../src/utils/external-integrations';

describe('external integrations', () => {
  it('builds Gran Publicador URLs from instance or api base URL', () => {
    expect(getGranPublicadorHealthUrl('https://gran.example.com')).toBe(
      'https://gran.example.com/api/v1/external/health',
    );
    expect(getGranPublicadorHealthUrl('https://gran.example.com/api/v1/external')).toBe(
      'https://gran.example.com/api/v1/external/health',
    );

    expect(
      getGranPublicadorConnectUrl({
        baseUrl: 'https://gran.example.com/api/v1',
        name: GRAN_PUBLICADOR_APP_NAME,
        redirectUri: 'http://localhost:3000/editor',
        scopes: ['vfs:read', 'stt:transcribe'],
      }),
    ).toBe(
      'https://gran.example.com/integrations/connect?name=Gran+Video+Editor&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Feditor&scopes=vfs%3Aread%2Cstt%3Atranscribe',
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

  it('builds STT stream URLs for Gran proxy and manual gateway', () => {
    expect(getGranPublicadorSttStreamUrl('https://gran.example.com')).toBe(
      'https://gran.example.com/api/v1/external/api/v1/transcribe/stream',
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

  it('resolves Gran connect scopes based on active overrides', () => {
    const integrations = createDefaultUserSettings().integrations;

    expect(resolveGranConnectScopes({ integrations })).toEqual(['vfs:read', 'stt:transcribe']);

    integrations.manualFilesApi.enabled = true;
    integrations.manualFilesApi.overrideGran = true;

    expect(resolveGranConnectScopes({ integrations })).toEqual(['stt:transcribe']);

    integrations.manualSttApi.enabled = true;
    integrations.manualSttApi.overrideGran = true;

    expect(resolveGranConnectScopes({ integrations })).toEqual([]);
  });

  it('prefers Gran Publicador when manual service does not override it', () => {
    const userSettings = createDefaultUserSettings();
    userSettings.integrations.granPublicador.enabled = true;
    userSettings.integrations.granPublicador.bearerToken = 'gp_token';
    userSettings.integrations.manualFilesApi.enabled = true;
    userSettings.integrations.manualFilesApi.baseUrl =
      'https://files.example.com/api/v1/external/vfs';
    userSettings.integrations.manualFilesApi.bearerToken = 'files_token';
    userSettings.integrations.manualFilesApi.overrideGran = false;

    const resolved = resolveExternalIntegrations({
      userSettings,
      granPublicadorBaseUrl: 'https://gran.example.com',
    });

    expect(resolved.files).toEqual({
      source: 'gran_publicador',
      baseUrl: 'https://gran.example.com/api/v1/external/vfs',
      bearerToken: 'gp_token',
      healthUrl: 'https://gran.example.com/api/v1/external/health',
    });
  });

  it('uses manual service when override is enabled', () => {
    const integrations = createDefaultUserSettings().integrations;
    integrations.granPublicador.enabled = true;
    integrations.granPublicador.bearerToken = 'gp_token';
    integrations.manualSttApi.enabled = true;
    integrations.manualSttApi.baseUrl = 'https://stt.example.com/api/v1/external/stt';
    integrations.manualSttApi.overrideGran = true;

    const resolved = resolveExternalServiceConfig({
      service: 'stt',
      integrations,
      granPublicadorBaseUrl: 'https://gran.example.com',
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
    userSettings.integrations.manualSttApi.overrideGran = true;

    expect(
      resolveSttStreamUrl({
        userSettings,
        granPublicadorBaseUrl: 'https://gran.example.com',
      }),
    ).toBe('https://stt.example.com/api/v1/transcribe/stream');
  });
});
