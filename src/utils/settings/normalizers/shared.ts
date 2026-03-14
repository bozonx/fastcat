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

  if (localeRaw === 'ru-RU' || localeRaw === 'ru') {
    return 'ru-RU';
  }

  if (localeRaw === 'en-US' || localeRaw === 'en') {
    return 'en-US';
  }

  return DEFAULT_USER_SETTINGS.locale;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
