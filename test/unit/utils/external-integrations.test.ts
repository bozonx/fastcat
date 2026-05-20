/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  joinUrl,
  getServiceInstanceBaseUrl,
  getFastCatPublicadorExternalApiBaseUrl,
  getFastCatPublicadorConnectUrl,
  getFastCatPublicadorHealthUrl,
  getManualServiceHealthUrl,
  getManualSttStreamUrl,
  resolveFastCatConnectScopes,
  resolveExternalServiceConfig,
} from '~/utils/external-integrations';

describe('external-integrations URL helpers', () => {
  it('joinUrl handles slashes correctly', () => {
    expect(joinUrl('https://example.com/', '/path')).toBe('https://example.com/path');
    expect(joinUrl('https://example.com', 'path')).toBe('https://example.com/path');
    expect(joinUrl('', 'path')).toBe('');
    expect(joinUrl('https://example.com', '')).toBe('https://example.com');
  });

  it('getServiceInstanceBaseUrl strips api suffix', () => {
    expect(getServiceInstanceBaseUrl('https://example.com/api/v1')).toBe('https://example.com');
    expect(getServiceInstanceBaseUrl('https://example.com/')).toBe('https://example.com');
  });

  it('getFastCatPublicadorExternalApiBaseUrl appends api/v1', () => {
    expect(getFastCatPublicadorExternalApiBaseUrl('https://example.com')).toBe(
      'https://example.com/api/v1',
    );
  });

  it('getFastCatPublicadorConnectUrl builds connect URL with query params', () => {
    const url = getFastCatPublicadorConnectUrl({
      uiUrl: 'https://example.com',
      name: 'My App',
      redirectUri: 'https://app.com/callback',
      scopes: ['content-library:read'],
      state: 'abc123',
    });
    expect(url).toContain('https://example.com/integrations/connect');
    expect(url).toContain('name=My+App');
    expect(url).toContain('redirect_uri=https%3A%2F%2Fapp.com%2Fcallback');
    expect(url).toContain('scopes=content-library%3Aread');
    expect(url).toContain('state=abc123');
  });

  it('getFastCatPublicadorHealthUrl returns health endpoint', () => {
    expect(getFastCatPublicadorHealthUrl('https://example.com')).toContain('external/health');
  });

  it('getManualServiceHealthUrl handles various base URLs', () => {
    expect(getManualServiceHealthUrl('https://example.com')).toBe(
      'https://example.com/api/v1/health',
    );
    expect(getManualServiceHealthUrl('https://example.com/api/v1')).toBe(
      'https://example.com/api/v1/health',
    );
    expect(getManualServiceHealthUrl('https://example.com/health')).toBe(
      'https://example.com/health',
    );
  });

  it('getManualSttStreamUrl handles various base URLs', () => {
    expect(getManualSttStreamUrl('https://example.com')).toBe(
      'https://example.com/api/v1/transcribe/stream',
    );
    expect(getManualSttStreamUrl('https://example.com/api/v1/stt')).toBe(
      'https://example.com/api/v1/transcribe/stream',
    );
  });
});

describe('resolveFastCatConnectScopes', () => {
  it('returns files scopes by default', () => {
    const scopes = resolveFastCatConnectScopes({
      integrations: { manualFilesApi: { enabled: false, overrideFastCat: false } },
    } as any);
    expect(scopes).toContain('content-library:read');
    expect(scopes).toContain('content-library:write');
    expect(scopes).not.toContain('stt:transcribe');
  });

  it('excludes files scopes when manual overrides', () => {
    const scopes = resolveFastCatConnectScopes({
      integrations: { manualFilesApi: { enabled: true, overrideFastCat: true } },
    } as any);
    expect(scopes).not.toContain('content-library:read');
  });

  it('includes STT scopes when requested', () => {
    const scopes = resolveFastCatConnectScopes({
      integrations: { manualFilesApi: { enabled: false, overrideFastCat: false } },
      includeStt: true,
    } as any);
    expect(scopes).toContain('stt:transcribe');
    expect(scopes).toContain('llm:chat');
  });
});

describe('resolveExternalServiceConfig', () => {
  it('returns null when no services are enabled', () => {
    const config = resolveExternalServiceConfig({
      service: 'files',
      integrations: {
        fastcatAccount: { enabled: false, bearerToken: '' },
        fastcatPublicador: { enabled: false, bearerToken: '' },
        manualFilesApi: { enabled: false, baseUrl: '', bearerToken: '', overrideFastCat: false },
      },
      bloggerDogApiUrl: 'https://bd.example.com',
    });
    expect(config).toBeNull();
  });

  it('prefers manual when overrideFastCat is set', () => {
    const config = resolveExternalServiceConfig({
      service: 'files',
      integrations: {
        fastcatAccount: { enabled: false, bearerToken: '' },
        fastcatPublicador: { enabled: true, bearerToken: 'token' },
        manualFilesApi: {
          enabled: true,
          baseUrl: 'https://manual.example.com',
          bearerToken: 'mtoken',
          overrideFastCat: true,
        },
      },
      bloggerDogApiUrl: 'https://bd.example.com',
    });
    expect(config).not.toBeNull();
    expect(config!.source).toBe('manual');
    expect(config!.baseUrl).toBe('https://manual.example.com');
  });
});
