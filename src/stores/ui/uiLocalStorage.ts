export const STORAGE_KEYS = {
  APP: {
    ALREADY_LAUNCHED: 'fastcat:app:already-launched',
    PREFER_DESKTOP: 'fastcat:app:prefer-desktop',
  },
  UI: {
    MONITOR_VOLUME: 'fastcat:ui:monitor-volume',
    MONITOR_MUTED: 'fastcat:ui:monitor-muted',
  },
} as const;

function isMobilePlatform(): boolean {
  if (typeof window === 'undefined' || !window.location) return false;
  return window.location.pathname.startsWith('/m');
}

export function getPlatformSuffix(): string {
  return isMobilePlatform() ? ':mobile' : '';
}

export function hasLocalStorageKey(key: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

export function readLocalStorageJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function readLocalStorageString(key: string, fallback: string | null = null): string | null {
  if (typeof window === 'undefined') return fallback;
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeLocalStorageJson(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return;
  }
}

export function writeLocalStorageString(key: string, value: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    return;
  }
}

export function clearUiCache() {
  if (typeof window === 'undefined') return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith('fastcat:')) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}
