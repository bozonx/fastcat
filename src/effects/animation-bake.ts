import type { ClipAnimations, ClipEffect, Keyframe, KeyframeTrack } from '~/timeline/types';
import type { VideoEffectSpec } from '~/types/generated/native-monitor/VideoEffectSpec';
import { evalTrackAt, parseEffectParamPath } from '~/timeline/animation/evaluate';
import { normalizeHexColor } from '~/utils/color';
import { buildEffectSpecs } from './build-specs';

/**
 * Spec-domain "baking" of effect-parameter keyframes.
 *
 * Effect params are animated in the UI-value domain, but `toEffectSpecs`
 * (per-manifest, TS-only) is the single source of truth for turning those UI
 * values into the cross-backend `VideoEffectSpec`. Rather than port every
 * manifest's conversion to Rust (native advances time itself and only receives
 * finished specs), we sample the UI params across the clip's keyframe times,
 * run `buildEffectSpecs` at each, and record how each *numeric/boolean spec
 * field* moves. Both engines then interpolate those baked spec-field tracks
 * with the shared keyframe evaluator and patch them onto a fixed base spec
 * list — identical on web and native, with zero per-manifest duplication.
 *
 * Interpolation therefore happens in the spec domain: exact at keyframe times
 * and for affine conversions (≈ every effect); eased segments are subdivided so
 * the smoothstep shape survives the piecewise-linear representation. Colour
 * (array) fields are not baked yet — only flat numeric/boolean UI params.
 */

/**
 * Intermediate samples inserted across every keyframe segment. Captures eased
 * (smoothstep) shape as piecewise-linear, and lets conditionally-emitted specs
 * (e.g. hue, which the manifest omits when its value is exactly 0) be resolved
 * by extrapolating from the nearby samples where they ARE present. Collinear
 * points are simplified away afterwards, so purely-linear params stay compact.
 */
const SEGMENT_SUBDIVISIONS = 12;

/** Max relative error tolerated when dropping a collinear interior keyframe. */
const SIMPLIFY_EPSILON = 1e-4;

/** One baked spec field: where it lives + how its value moves over local time. */
export interface BakedEffectField {
  /** Index into {@link ClipBakedEffects.baseSpecs}. */
  specIndex: number;
  /** The numeric/boolean field on that spec (e.g. `value`, `radius`, `bleed`). */
  field: string;
  kind: 'number' | 'bool';
  /** Source-relative µs → number (booleans stored as 0/1). Linear easing. */
  keyframes: Keyframe[];
}

/** A clip's baked effect animation: fixed base specs + the fields that move. */
export interface ClipBakedEffects {
  /** Flattened `VideoEffectSpec[]` (all enabled video effects) at the reference sample. */
  baseSpecs: VideoEffectSpec[];
  fields: BakedEffectField[];
}

type FieldValue = number | boolean;

function isBakeableField(value: unknown): value is FieldValue {
  return typeof value === 'number' || typeof value === 'boolean';
}

function numericFieldAt(
  spec: Record<string, unknown> | undefined,
  field: string,
): number | undefined {
  const [root, indexRaw] = field.split('.', 2);
  if (!root) return undefined;
  if (indexRaw !== undefined) {
    const arr = spec?.[root];
    const index = Number(indexRaw);
    return Array.isArray(arr) && Number.isInteger(index)
      ? numericFieldValue(arr[index])
      : undefined;
  }
  return numericFieldValue(spec?.[field]);
}

function setSpecField(spec: Record<string, unknown>, field: string, value: unknown): void {
  const [root, indexRaw] = field.split('.', 2);
  if (!root || indexRaw === undefined) {
    spec[field] = value;
    return;
  }
  const index = Number(indexRaw);
  if (!Number.isInteger(index)) return;
  const current = spec[root];
  const arr = Array.isArray(current) ? [...current] : [];
  arr[index] = value;
  spec[root] = arr;
}

function colorChannelToHex(value: unknown): string {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : Number(value);
  return Math.max(0, Math.min(255, Math.round(n || 0)))
    .toString(16)
    .padStart(2, '0');
}

function setNestedAnimatedParam(next: Record<string, unknown>, key: string, value: number): void {
  const [root, channel] = key.split('.', 2);
  if (!root || !channel) {
    next[key] = typeof next[key] === 'boolean' ? value >= 0.5 : value;
    return;
  }

  if (typeof next[root] === 'string' && (channel === 'r' || channel === 'g' || channel === 'b')) {
    const hex = normalizeHexColor(next[root], '#000000').slice(1);
    const rgb = {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
      [channel]: value,
    };
    next[root] =
      `#${colorChannelToHex(rgb.r)}${colorChannelToHex(rgb.g)}${colorChannelToHex(rgb.b)}`;
    return;
  }

  const current = next[root];
  const obj = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  next[root] = { ...(obj as Record<string, unknown>), [channel]: value };
}

/** Apply the animated params of one effect at time `t` (flat keys only). */
function overrideEffect(
  effect: ClipEffect,
  params: Map<string, KeyframeTrack> | undefined,
  t: number,
): ClipEffect {
  if (!params || params.size === 0) return effect;
  const next: Record<string, unknown> = { ...effect };
  for (const [key, track] of params) {
    const value = evalTrackAt(track, t);
    if (value === undefined) continue;
    setNestedAnimatedParam(next, key, value);
  }
  return next as ClipEffect;
}

/**
 * The times to sample `toEffectSpecs` at: every animated param's keyframe times
 * with each segment subdivided, so both eased shape and conditional-emission
 * boundaries are captured.
 */
function collectSampleTimes(byEffect: Map<string, Map<string, KeyframeTrack>>): number[] {
  const times = new Set<number>();
  for (const params of byEffect.values()) {
    for (const track of params.values()) {
      const kfs = track.keyframes;
      for (let i = 0; i < kfs.length; i++) {
        const kf = kfs[i]!;
        times.add(Math.round(kf.tUs));
        const next = kfs[i + 1];
        if (next) {
          const span = next.tUs - kf.tUs;
          for (let s = 1; s < SEGMENT_SUBDIVISIONS; s++) {
            times.add(Math.round(kf.tUs + (span * s) / SEGMENT_SUBDIVISIONS));
          }
        }
      }
    }
  }
  return Array.from(times).sort((a, b) => a - b);
}

function numericFieldValue(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'boolean') return raw ? 1 : 0;
  return undefined;
}

/**
 * Fill sample slots where a spec was absent (conditional emission) by linearly
 * interpolating between the nearest present slots, and extrapolating linearly
 * off the two nearest present slots at the ends. Returns `null` if fewer than
 * one present slot (nothing to anchor on).
 */
function fillPresence(times: number[], values: (number | undefined)[]): number[] | null {
  const present = values.map((v, i) => (v !== undefined ? i : -1)).filter((i) => i >= 0);
  if (present.length === 0) return null;
  if (present.length === 1) return values.map(() => values[present[0]!]!);

  const out = values.slice() as number[];
  const at = (i: number) => ({ t: times[i]!, v: values[i]! });
  const lerp = (a: { t: number; v: number }, b: { t: number; v: number }, t: number) =>
    b.t === a.t ? a.v : a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);

  for (let i = 0; i < values.length; i++) {
    if (values[i] !== undefined) continue;
    if (i < present[0]!) {
      out[i] = lerp(at(present[0]!), at(present[1]!), times[i]!);
    } else if (i > present[present.length - 1]!) {
      out[i] = lerp(at(present[present.length - 2]!), at(present[present.length - 1]!), times[i]!);
    } else {
      let lo = present[0]!;
      let hi = present[present.length - 1]!;
      for (const p of present) {
        if (p <= i) lo = p;
        if (p >= i) {
          hi = p;
          break;
        }
      }
      out[i] = lerp(at(lo), at(hi), times[i]!);
    }
  }
  return out;
}

/** Drop interior keyframes that lie (within epsilon) on the line of their neighbours. */
function simplifyCollinear(keyframes: Keyframe[]): Keyframe[] {
  if (keyframes.length <= 2) return keyframes;
  const out: Keyframe[] = [keyframes[0]!];
  for (let i = 1; i < keyframes.length - 1; i++) {
    const a = out[out.length - 1]!;
    const b = keyframes[i]!;
    const c = keyframes[i + 1]!;
    const span = c.tUs - a.tUs;
    const expected =
      span === 0 ? a.value : a.value + ((c.value - a.value) * (b.tUs - a.tUs)) / span;
    const scale = Math.max(1, Math.abs(a.value), Math.abs(c.value));
    if (Math.abs(b.value - expected) > SIMPLIFY_EPSILON * scale) out.push(b);
  }
  out.push(keyframes[keyframes.length - 1]!);
  return out;
}

/** Diff the numeric/boolean fields of the base specs across all samples. */
function diffFields(
  baseSpecs: VideoEffectSpec[],
  samples: { t: number; specs: VideoEffectSpec[] }[],
): BakedEffectField[] {
  const fields: BakedEffectField[] = [];
  const times = samples.map((s) => s.t);

  for (let specIndex = 0; specIndex < baseSpecs.length; specIndex++) {
    const base = baseSpecs[specIndex] as unknown as Record<string, unknown>;
    const fieldNames: string[] = [];
    for (const field of Object.keys(base)) {
      const value = base[field];
      if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
          if (typeof value[index] === 'number') fieldNames.push(`${field}.${index}`);
        }
      } else {
        fieldNames.push(field);
      }
    }
    for (const rawField of fieldNames) {
      const field = String(rawField);
      if (field === 'type') continue;
      const isArrayField = field.includes('.');
      const rawBaseValue = isArrayField ? numericFieldAt(base, field) : base[field];
      if (!isBakeableField(rawBaseValue)) continue;

      const kind: 'number' | 'bool' = typeof rawBaseValue === 'boolean' ? 'bool' : 'number';
      const raw = samples.map((s) => {
        const spec = s.specs[specIndex] as unknown as Record<string, unknown> | undefined;
        return numericFieldAt(spec, field);
      });
      const filled = fillPresence(times, raw);
      if (!filled) continue;

      const varies = filled.some((v) => v !== filled[0]);
      if (!varies) continue;

      const keyframes = simplifyCollinear(
        filled.map((value, i) => ({
          tUs: times[i]!,
          // Booleans step: snap to 0/1 so intermediate lerps don't blur the flip.
          value: kind === 'bool' ? (value >= 0.5 ? 1 : 0) : value,
          easing: 'linear' as const,
        })),
      );
      fields.push({ specIndex, field, kind, keyframes });
    }
  }

  return fields;
}

/**
 * Bake a clip's effect-parameter keyframes into spec-field tracks. Returns
 * `undefined` when the clip has no animated effect params (callers then use the
 * static {@link buildEffectSpecs} path).
 */
export function bakeClipEffectAnimations(
  effects: ClipEffect[] | undefined,
  animations: ClipAnimations | undefined,
): ClipBakedEffects | undefined {
  if (!Array.isArray(effects) || effects.length === 0 || !animations) return undefined;

  const byEffect = new Map<string, Map<string, KeyframeTrack>>();
  for (const [path, track] of Object.entries(animations)) {
    if (!track || track.keyframes.length === 0) continue;
    const parsed = parseEffectParamPath(path);
    if (!parsed) continue;
    let params = byEffect.get(parsed.effectId);
    if (!params) {
      params = new Map();
      byEffect.set(parsed.effectId, params);
    }
    params.set(parsed.key, track);
  }
  if (byEffect.size === 0) return undefined;

  const sampleTimes = collectSampleTimes(byEffect);
  if (sampleTimes.length === 0) return undefined;

  const samples = sampleTimes.map((t) => ({
    t,
    specs:
      buildEffectSpecs(
        effects.map((effect) => overrideEffect(effect, byEffect.get(effect.id), t)),
      ) ?? [],
  }));

  // Reference = the sample with the most specs, so conditionally-emitted specs
  // (e.g. hue appearing only when its value ≠ 0) are represented in the base.
  let baseIdx = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i]!.specs.length > samples[baseIdx]!.specs.length) baseIdx = i;
  }
  const baseSpecs = JSON.parse(JSON.stringify(samples[baseIdx]!.specs)) as VideoEffectSpec[];
  if (baseSpecs.length === 0) return undefined;

  const fields = diffFields(baseSpecs, samples);
  if (fields.length === 0) return undefined;

  return { baseSpecs, fields };
}

/**
 * Resolve a clip's baked effect specs at `localTimeUs` (source-relative µs):
 * the base specs with every baked field overwritten by its sampled value.
 * Shared shape with the native patcher; pinned by a parity fixture.
 */
export function patchBakedEffectSpecs(
  baked: ClipBakedEffects,
  localTimeUs: number,
): VideoEffectSpec[] {
  const specs = baked.baseSpecs.map((spec) => ({ ...spec }));
  for (const f of baked.fields) {
    const spec = specs[f.specIndex] as Record<string, unknown> | undefined;
    if (!spec) continue;
    const value = evalTrackAt({ keyframes: f.keyframes }, localTimeUs);
    if (value === undefined) continue;
    setSpecField(spec, f.field, f.kind === 'bool' ? value >= 0.5 : value);
  }
  return specs;
}
