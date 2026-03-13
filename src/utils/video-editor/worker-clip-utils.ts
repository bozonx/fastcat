import { clampNumber } from '~/utils/audio/envelope';
import {
  VIDEO_DIR_NAME,
  AUDIO_DIR_NAME,
  IMAGES_DIR_NAME,
  TIMELINES_DIR_NAME,
} from '~/utils/constants';

export function cloneEffects<T>(effects: T): T {
  if (effects === null || effects === undefined) return effects;
  try {
    return JSON.parse(JSON.stringify(effects)) as T;
  } catch {
    return effects;
  }
}

export function clonePlain<T>(value: T): T {
  if (value === null || value === undefined) return value;
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

export function mergeFadeInUs(input: {
  childFadeInUs: unknown;
  parentFadeInUs: unknown;
  parentLocalStartUs: number;
}): number | undefined {
  const child = clampNumber(input.childFadeInUs, 0, Number.MAX_SAFE_INTEGER);
  const parent = clampNumber(input.parentFadeInUs, 0, Number.MAX_SAFE_INTEGER);
  if (!parent || parent <= 0) return child;
  const remaining = Math.max(0, Math.round(parent - input.parentLocalStartUs));
  if (remaining <= 0) return child;
  if (child === undefined) return remaining;
  return Math.max(child, remaining);
}

export function mergeFadeOutUs(input: {
  childFadeOutUs: unknown;
  parentFadeOutUs: unknown;
  parentLocalEndUs: number;
  parentDurationUs: number;
}): number | undefined {
  const child = clampNumber(input.childFadeOutUs, 0, Number.MAX_SAFE_INTEGER);
  const parent = clampNumber(input.parentFadeOutUs, 0, Number.MAX_SAFE_INTEGER);
  if (!parent || parent <= 0) return child;
  const outStart = Math.max(0, Math.round(input.parentDurationUs - parent));
  if (input.parentLocalEndUs <= outStart) return child;
  const remaining = Math.max(
    0,
    Math.round(parent - (input.parentDurationUs - input.parentLocalEndUs)),
  );
  if (remaining <= 0) return child;
  if (child === undefined) return remaining;
  return Math.max(child, remaining);
}

export function isProbablyUrlLike(path: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path);
}

export function getDirname(path: string): string {
  const normalized = String(path).replace(/\\/g, '/');
  const isAbsolute = normalized.startsWith('/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 1) return isAbsolute ? '/' : '';
  parts.pop();
  const joined = parts.join('/');
  return isAbsolute ? `/${joined}` : joined;
}

export function joinPaths(left: string, right: string): string {
  const l = String(left).replace(/\\/g, '/').replace(/\/+$/g, '');
  const r = String(right).replace(/\\/g, '/').replace(/^\/+/, '');
  if (!l) return r;
  if (!r) return l;
  return `${l}/${r}`;
}

export function resolveNestedMediaPath(params: {
  nestedTimelinePath: string;
  mediaPath: string;
}): string {
  const mediaPath = String(params.mediaPath);
  if (!mediaPath) return mediaPath;
  if (mediaPath.startsWith('/')) return mediaPath;
  if (isProbablyUrlLike(mediaPath)) return mediaPath;
  if (
    mediaPath.startsWith(`${VIDEO_DIR_NAME}/`) ||
    mediaPath.startsWith(`${AUDIO_DIR_NAME}/`) ||
    mediaPath.startsWith(`${IMAGES_DIR_NAME}/`) ||
    mediaPath.startsWith(`${TIMELINES_DIR_NAME}/`)
  ) {
    return mediaPath;
  }
  const baseDir = getDirname(params.nestedTimelinePath);
  if (!baseDir) return mediaPath;
  return joinPaths(baseDir, mediaPath);
}
