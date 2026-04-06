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
    expect(getFastCatPublicadorHealthUrl('https://fastcat.example.com/api/v1')).toBe(
      'https://fastcat.example.com/api/v1/external/health',
    );

    expect(
      getFastCatPublicadorConnectUrl({
        uiUrl: 'https://fastcat.example.com/api/v1',
        name: FASTCAT_PUBLICADOR_APP_NAME,
        redirectUri: 'http://localhost:3000/editor',
        scopes: ['content-library:read', 'stt:transcribe'],
      }),
    ).toBe(
      'https://fastcat.example.com/integrations/connect?name=FastCat&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Feditor&scopes=content-library%3Aread%2Cstt%3Atranscribe',
    );
  });

  it('builds manual health URL as /api/v1/health', () => {
    expect(getManualServiceHealthUrl('https://api.example.com/api/v1/vfs')).toBe(
      'https://api.example.com/api/v1/health',
    );
    expect(getManualServiceHealthUrl('https://stt.example.com')).toBe(
      'https://stt.example.com/api/v1/health',
    );
    expect(getManualServiceHealthUrl('https://stt.example.com/api/v1')).toBe(
      'https://stt.example.com/api/v1/health',
    );
  });

  it('builds STT stream URLs for FastCat proxy and manual gateway', () => {
    expect(getFastCatPublicadorSttStreamUrl('https://fastcat.example.com')).toBe(
      'https://fastcat.example.com/api/v1/transcribe/stream',
    );

    expect(getManualSttStreamUrl('https://stt.example.com')).toBe(
      'https://stt.example.com/api/v1/transcribe/stream',
    );
    expect(getManualSttStreamUrl('https://stt.example.com/api/v1')).toBe(
      'https://stt.example.com/api/v1/transcribe/stream',
    );
    expect(getManualSttStreamUrl('https://stt.example.com/api/v1/stt')).toBe(
      'https://stt.example.com/api/v1/transcribe/stream',
    );
  });

  it('resolves FastCat connect scopes based on active overrides', () => {
    const integrations = createDefaultUserSettings().integrations;

    expect(resolveFastCatConnectScopes({ integrations, includeStt: true })).toEqual([
      'content-library:read',
      'content-library:write',
      'stt:transcribe',
      'llm:chat',
    ]);

    integrations.manualFilesApi.enabled = true;
    integrations.manualFilesApi.overrideFastCat = true;

    expect(resolveFastCatConnectScopes({ integrations, includeStt: true })).toEqual([
      'stt:transcribe',
      'llm:chat',
    ]);
  });

  it('prefers FastCat Publicador when manual service does not override it', () => {
    const userSettings = createDefaultUserSettings();
    userSettings.integrations.fastcatPublicador.enabled = true;
    userSettings.integrations.fastcatPublicador.bearerToken = 'gp_token';
    userSettings.integrations.manualFilesApi.enabled = true;
    userSettings.integrations.manualFilesApi.baseUrl = 'https://files.example.com/api/v1/content-library';
    userSettings.integrations.manualFilesApi.bearerToken = 'files_token';
    userSettings.integrations.manualFilesApi.overrideFastCat = false;

    const resolved = resolveExternalIntegrations({
      userSettings,
      bloggerDogApiUrl: 'https://fastcat.example.com',
      fastcatAccountApiUrl: 'https://fastcat-acc.example.com',
    });

    expect(resolved.files).toEqual({
      source: 'fastcat_publicador',
      baseUrl: 'https://fastcat.example.com/api/v1/external/content-library',
      bearerToken: 'gp_token',
      healthUrl: 'https://fastcat.example.com/api/v1/external/health',
    });
  });

  it('uses FastCat Account for STT', () => {
    const integrations = createDefaultUserSettings().integrations;
    integrations.fastcatAccount.enabled = true;
    integrations.fastcatAccount.bearerToken = 'acc_token';

    const resolved = resolveExternalServiceConfig({
      service: 'stt',
      integrations,
      bloggerDogApiUrl: 'https://fastcat.example.com',
      fastcatAccountApiUrl: 'https://fastcat-acc.example.com',
    });

    expect(resolved).toEqual({
      source: 'fastcat_publicador',
      baseUrl: 'https://fastcat-acc.example.com/api/v1/external/stt',
      bearerToken: 'acc_token',
      healthUrl: 'https://fastcat-acc.example.com/api/v1/external/health',
    });
  });

  it('resolves STT stream URL from FastCat Account', () => {
    const userSettings = createDefaultUserSettings();
    userSettings.integrations.fastcatAccount.enabled = true;
    userSettings.integrations.fastcatAccount.bearerToken = 'acc_token';

    expect(
      resolveSttStreamUrl({
        userSettings,
        fastcatAccountApiUrl: 'https://fastcat-acc.example.com',
      }),
    ).toBe('https://fastcat-acc.example.com/api/v1/transcribe/stream');
  });
});
