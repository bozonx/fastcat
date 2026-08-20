import { clampNumber } from '~/utils/math';
import { cloneValue } from '~/utils/clone';
import {
  VIDEO_DIR_NAME,
  AUDIO_DIR_NAME,
  IMAGES_DIR_NAME,
  TIMELINES_DIR_NAME,
} from '~/utils/constants';
import type { ClipTransform, ClipSourceOrientation } from '~/timeline/types';

// Deep clone of a clip's effects array before it crosses into a worker payload.
// Named separately from `clonePlain` to document intent at call sites; both
// delegate to the single shared `cloneValue` (structuredClone, JSON fallback).
export function cloneEffects<T>(effects: T): T {
  return cloneValue(effects);
}

export function clonePlain<T>(value: T): T {
  return cloneValue(value);
}

export function mergeFadeInTicks(input: {
  childFadeInTicks: unknown;
  parentFadeInTicks: unknown;
  parentLocalStartTicks: number;
}): number | undefined {
  const child = clampNumber(input.childFadeInTicks, 0, Number.MAX_SAFE_INTEGER);
  const parent = clampNumber(input.parentFadeInTicks, 0, Number.MAX_SAFE_INTEGER);
  if (!parent || parent <= 0) return child;
  const remaining = Math.max(0, Math.round(parent - input.parentLocalStartTicks));
  if (remaining <= 0) return child;
  if (child === undefined) return remaining;
  return Math.max(child, remaining);
}

export function mergeFadeOutTicks(input: {
  childFadeOutTicks: unknown;
  parentFadeOutTicks: unknown;
  parentLocalEndTicks: number;
  parentDurationTicks: number;
}): number | undefined {
  const child = clampNumber(input.childFadeOutTicks, 0, Number.MAX_SAFE_INTEGER);
  const parent = clampNumber(input.parentFadeOutTicks, 0, Number.MAX_SAFE_INTEGER);
  if (!parent || parent <= 0) return child;
  const outStart = Math.max(0, Math.round(input.parentDurationTicks - parent));
  if (input.parentLocalEndTicks <= outStart) return child;
  const remaining = Math.max(
    0,
    Math.round(parent - (input.parentDurationTicks - input.parentLocalEndTicks)),
  );
  if (remaining <= 0) return child;
  if (child === undefined) return remaining;
  return Math.max(child, remaining);
}

/**
 * Maps an explicit clip source orientation to degrees.
 *
 * Cross-engine parity contract: the native engine maps the same values in
 * `source_orientation_deg` (src-tauri/src/monitor/scene/build/transform.rs),
 * pinned by `shared/parity/source-orientation-deg.cases.json`.
 */
export function sourceOrientationToDeg(orientation: ClipSourceOrientation | undefined): number {
  switch (orientation) {
    case '90':
      return 90;
    case '180':
      return 180;
    case '270':
      return 270;
    default:
      return 0;
  }
}

function isIdentityTransform(t: ClipTransform | undefined): boolean {
  if (!t) return true;
  const sx = t.scale?.x ?? 1;
  const sy = t.scale?.y ?? 1;
  const px = t.position?.x ?? 0;
  const py = t.position?.y ?? 0;
  const rot = t.rotationDeg ?? 0;
  const crop = t.crop;
  const hasCrop =
    !!crop && ((crop.top ?? 0) || (crop.bottom ?? 0) || (crop.left ?? 0) || (crop.right ?? 0));
  return sx === 1 && sy === 1 && px === 0 && py === 0 && rot === 0 && !hasCrop;
}

/**
 * Composes a nested-timeline clip's (parent) transform onto one of its expanded
 * inner clips (child) so the nested block behaves like a normal video clip.
 *
 * Both transforms are expressed in the shared design-base coordinate space
 * (position in design-base px, scale unitless, rotation in degrees) and are
 * composed about the centered fit box — i.e. `world = Parent(Child(v))`:
 *
 *   scaleFinal      = scaleParent · scaleChild
 *   rotationFinal   = rotationParent + rotationChild
 *   positionFinal   = R(rotationParent) · (scaleParent ⊙ positionChild) + positionParent
 *
 * The child's anchor and crop are preserved (they describe the inner content);
 * the parent's anchor and crop are intentionally dropped because in the flat
 * (non-sub-scene) model there is no nested frame to anchor/crop against. The
 * decomposition is exact for a uniform parent scale; a non-uniform parent scale
 * combined with rotation introduces shear that is approximated as scale+rotate.
 * The parent's `sourceOrientation` (quarter turns) folds into the rotation.
 */
export function composeNestedTransform(params: {
  parent: ClipTransform | undefined;
  parentOrientation?: ClipSourceOrientation;
  child: ClipTransform | undefined;
}): ClipTransform | undefined {
  const parentOrientationDeg = sourceOrientationToDeg(params.parentOrientation);
  if (isIdentityTransform(params.parent) && parentOrientationDeg === 0) {
    return params.child ? clonePlain(params.child) : undefined;
  }

  const p = params.parent;
  const c = params.child;

  const pSx = p?.scale?.x ?? 1;
  const pSy = p?.scale?.y ?? 1;
  const pRot = (p?.rotationDeg ?? 0) + parentOrientationDeg;
  const pPx = p?.position?.x ?? 0;
  const pPy = p?.position?.y ?? 0;

  const cSx = c?.scale?.x ?? 1;
  const cSy = c?.scale?.y ?? 1;
  const cRot = c?.rotationDeg ?? 0;
  const cPx = c?.position?.x ?? 0;
  const cPy = c?.position?.y ?? 0;

  const rad = (pRot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const scaledChildX = pSx * cPx;
  const scaledChildY = pSy * cPy;

  const positionX = cos * scaledChildX - sin * scaledChildY + pPx;
  const positionY = sin * scaledChildX + cos * scaledChildY + pPy;

  const result: ClipTransform = {
    scale: { x: pSx * cSx, y: pSy * cSy },
    rotationDeg: pRot + cRot,
    position: { x: positionX, y: positionY },
  };

  // Preserve the inner content's anchor and crop; the parent's are dropped.
  if (c?.anchor) result.anchor = clonePlain(c.anchor);
  if (c?.crop) result.crop = clonePlain(c.crop);

  return result;
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

export function normalizeProjectPath(path: string): string {
  const raw = String(path).trim().replace(/\\/g, '/');
  if (!raw || isProbablyUrlLike(raw)) return raw;

  const isAbsolute = raw.startsWith('/');
  const parts: string[] = [];

  for (const part of raw.split('/')) {
    const trimmed = part.trim();
    if (!trimmed || trimmed === '.') continue;
    if (trimmed === '..') {
      if (parts.length > 0 && parts[parts.length - 1] !== '..') {
        parts.pop();
      } else if (!isAbsolute) {
        parts.push(trimmed);
      }
      continue;
    }
    parts.push(trimmed);
  }

  const normalized = parts.join('/');
  return isAbsolute ? `/${normalized}` : normalized;
}

export function resolveNestedMediaPath(params: {
  nestedTimelinePath: string;
  mediaPath: string;
}): string {
  const mediaPath = String(params.mediaPath);
  if (!mediaPath) return mediaPath;
  if (mediaPath.startsWith('/')) return normalizeProjectPath(mediaPath);
  if (isProbablyUrlLike(mediaPath)) return mediaPath;
  if (
    mediaPath.startsWith(`${VIDEO_DIR_NAME}/`) ||
    mediaPath.startsWith(`${AUDIO_DIR_NAME}/`) ||
    mediaPath.startsWith(`${IMAGES_DIR_NAME}/`) ||
    mediaPath.startsWith(`${TIMELINES_DIR_NAME}/`)
  ) {
    return normalizeProjectPath(mediaPath);
  }
  const baseDir = getDirname(params.nestedTimelinePath);
  if (!baseDir) return normalizeProjectPath(mediaPath);
  return normalizeProjectPath(joinPaths(baseDir, mediaPath));
}
