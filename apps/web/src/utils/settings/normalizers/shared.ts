import { DEFAULT_USER_SETTINGS } from '../defaults';
import type { FastCatUserSettings } from '../defaults';

export function normalizeUrlValue(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
}

export function normalizeTokenValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeStoragePathValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeLocale(raw: Record<string, unknown>): FastCatUserSettings['locale'] {
  const localeRaw = raw.locale ?? raw.language ?? raw.lang;

  if (typeof localeRaw === 'string') {
    const normalized = localeRaw.toLowerCase();

    if (normalized === 'ru' || normalized === 'ru-ru') {
      return 'ru-RU';
    }

    if (normalized === 'en' || normalized === 'en-us') {
      return 'en-US';
    }

    // Collapse every regional variant of Spanish (es, es-ES, es-MX, es-AR, …)
    // into the single Latin-American locale bundled with the editor.
    if (normalized === 'es' || normalized.startsWith('es-')) {
      return 'es-419';
    }
  }

  return DEFAULT_USER_SETTINGS.locale;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
