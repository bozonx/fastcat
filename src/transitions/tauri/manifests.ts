import type { TransitionManifest, TauriTransitionSpec } from '../core/registry';

// ---------------------------------------------------------------------------
// Helpers (mirror the web manifests so the Tauri specs stay 1:1 with PixiJS).
// ---------------------------------------------------------------------------

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const transparent = () => 1;

function normalizeDirection(value: unknown): 'left' | 'right' | 'up' | 'down' {
  return value === 'right' || value === 'up' || value === 'down' || value === 'left'
    ? value
    : 'left';
}

/** Direction → screen-space unit vector (matches the web `getDirectionVector`). */
function directionVector(value: unknown): [number, number] {
  const direction = normalizeDirection(value);
  if (direction === 'right') return [1, 0];
  if (direction === 'up') return [0, -1];
  if (direction === 'down') return [0, 1];
  return [-1, 0];
}

function directionIndex(value: unknown): number {
  const direction = normalizeDirection(value);
  if (direction === 'right') return 1;
  if (direction === 'up') return 2;
  if (direction === 'down') return 3;
  return 0;
}

function normalizeTransitionColor(value: unknown, fallback = '#000000'): string {
  const raw = String(value ?? '')
    .trim()
    .replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    const r = raw[0] ?? '0';
    const g = raw[1] ?? '0';
    const b = raw[2] ?? '0';
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return /^[0-9a-fA-F]{6}$/.test(raw) ? `#${raw}`.toLowerCase() : fallback;
}

/** Hex string → linear [0..1] rgb triple. */
function hexToRgb01(value: unknown, fallback = '#000000'): [number, number, number] {
  const hex = normalizeTransitionColor(value, fallback).slice(1);
  const n = Number.parseInt(hex, 16);
  if (!Number.isFinite(n)) return [0, 0, 0];
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

function qualitySamples(quality: unknown, low: number, med: number, high: number, ultra: number) {
  if (quality === 'low') return low;
  if (quality === 'high') return high;
  if (quality === 'ultra') return ultra;
  return med;
}

/**
 * Resolves effective blur quality from export/playback state and user settings.
 * Priority: export → resolved preview quality → paused auto fallback → transition default.
 */
function resolveBlurQuality(
  options: { isExport?: boolean; isPlaying?: boolean; previewBlurQuality?: string } | undefined,
  perTransitionQuality: unknown,
): string {
  if (options?.isExport) return 'ultra';
  const preview = options?.previewBlurQuality;
  if (preview && preview !== 'auto') return preview;
  if (options?.isPlaying === false) return 'ultra';
  // 'auto' or unset: fall back to the per-transition setting (default 'medium')
  return typeof perTransitionQuality === 'string' ? perTransitionQuality : 'medium';
}

/**
 * Static part of the motion-blur magnitude (`baseSpeed * motionBlur * factor`).
 * The web manifests additionally scale blur by the curve's instantaneous speed
 * (a per-frame derivative). Native applies that derivative at render time via the
 * per-frame `uni.speed` uniform (computed in `layer_builder.rs` from the curve),
 * which the slide/blinds shaders multiply into this magnitude — so blur now grows
 * and shrinks with the curve instead of staying flat.
 */
function motionBlurConst(motionBlur: number, durationSec: number | undefined, factor = 0.05) {
  if (motionBlur > 0 && durationSec && durationSec > 0) {
    return (1 / durationSec) * motionBlur * factor;
  }
  return 0;
}

/** anchor + offset → normalized center, identical to the web rectangle/circle. */
function centerFromAnchor(params: Record<string, unknown>): [number, number] {
  const anchor = typeof params.anchor === 'string' ? params.anchor : 'center';
  const offsetX = clamp(finiteNumber(params.offsetX, 0), -100, 100) / 100;
  const offsetY = clamp(finiteNumber(params.offsetY, 0), -100, 100) / 100;

  if (anchor === 'top-left') return [offsetX, offsetY];
  if (anchor === 'top-right') return [1 - offsetX, offsetY];
  if (anchor === 'bottom-left') return [offsetX, 1 - offsetY];
  if (anchor === 'bottom-right') return [1 - offsetX, 1 - offsetY];
  return [0.5 + offsetX, 0.5 + offsetY];
}

function wipeAxis(direction: unknown, angleDeg: number): [number, number] {
  const [bx, by] = directionVector(direction);
  const a = (angleDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [bx * c - by * s, bx * s + by * c];
}

function normalizeCircleParams(params?: Record<string, unknown>): Record<string, unknown> {
  const anchor =
    typeof params?.anchor === 'string' &&
    ['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(params.anchor)
      ? params.anchor
      : 'center';

  return {
    blur: clamp(finiteNumber(params?.blur, 1.5), 0, 20),
    blurMode: params?.blurMode === 'scaled' ? 'scaled' : 'fixed',
    direction: params?.direction === 'to-center' ? 'to-center' : 'from-center',
    anchor,
    offsetX: clamp(finiteNumber(params?.offsetX, 0), -100, 100),
    offsetY: clamp(finiteNumber(params?.offsetY, 0), -100, 100),
    scaleX: clamp(finiteNumber(params?.scaleX, 100), 1, 1000),
    scaleY: clamp(finiteNumber(params?.scaleY, 100), 1, 1000),
    followScale: params?.followScale === true,
  };
}

function normalizeClockParams(params?: Record<string, unknown>): Record<string, unknown> {
  const direction = params?.direction as string;
  return {
    direction:
      direction === 'counterclockwise' || direction === 'symmetric' ? direction : 'clockwise',
  };
}

function normalizeMotionBlurParams(params?: Record<string, unknown>): Record<string, unknown> {
  const blurQuality =
    params?.blurQuality === 'low' ||
    params?.blurQuality === 'medium' ||
    params?.blurQuality === 'high' ||
    params?.blurQuality === 'ultra'
      ? params.blurQuality
      : 'medium';

  return {
    angle: clamp(finiteNumber(params?.angle, 0), -180, 180),
    motionBlur: clamp(finiteNumber(params?.motionBlur, 50), 0, 100),
    blurQuality,
    motionBlurMode: params?.motionBlurMode === 'bloom' ? 'bloom' : 'normal',
    brightness: clamp(finiteNumber(params?.brightness, 0), -10, 10),
    bloomThreshold: clamp(finiteNumber(params?.bloomThreshold, 0.7), 0, 1),
  };
}

function normalizeRectangleParams(params?: Record<string, unknown>): Record<string, unknown> {
  const anchor =
    typeof params?.anchor === 'string' &&
    ['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(params.anchor)
      ? params.anchor
      : 'center';

  return {
    blur: clamp(finiteNumber(params?.blur, 1.5), 0, 20),
    blurMode: params?.blurMode === 'scaled' ? 'scaled' : 'fixed',
    direction: params?.direction === 'to-center' ? 'to-center' : 'from-center',
    anchor,
    offsetX: clamp(finiteNumber(params?.offsetX, 0), -100, 100),
    offsetY: clamp(finiteNumber(params?.offsetY, 0), -100, 100),
    contentMode: params?.contentMode === 'zoom' ? 'zoom' : 'reveal',
  };
}

// ---------------------------------------------------------------------------
// Shared WGSL prelude. The native transition pipeline binds:
//   0: from_tex, 1: to_tex, 2: output_tex (storage), 3: uniform (progress + p0..p11)
// Both inputs are pre-scaled (bilinear blit) to the output size, so `samp` reads
// in normalized [0..1] space and is the identity at integer texel centers.
// ---------------------------------------------------------------------------

const WGSL_HEAD = `@group(0) @binding(0) var from_tex: texture_2d<f32>;
@group(0) @binding(1) var to_tex: texture_2d<f32>;
@group(0) @binding(2) var output_tex: texture_storage_2d<rgba8unorm, write>;

struct TransitionUniform {
    progress: f32,
    width: u32,
    height: u32,
    speed: f32,
    p0: f32, p1: f32, p2: f32, p3: f32,
    p4: f32, p5: f32, p6: f32, p7: f32,
    p8: f32, p9: f32, p10: f32, p11: f32,
};
@group(0) @binding(3) var<uniform> uni: TransitionUniform;

const PI: f32 = 3.1415926535897932384626433832795;

fn dims() -> vec2<f32> { return vec2<f32>(f32(uni.width), f32(uni.height)); }

fn ld(tex: texture_2d<f32>, p: vec2<i32>) -> vec4<f32> {
    let c = vec2<i32>(
        clamp(p.x, 0, i32(uni.width) - 1),
        clamp(p.y, 0, i32(uni.height) - 1)
    );
    return textureLoad(tex, c, 0);
}

// Bilinear sample in normalized UV (clamp-to-edge, matching PixiJS textures).
fn samp(tex: texture_2d<f32>, uv: vec2<f32>) -> vec4<f32> {
    let sp = uv * dims() - vec2<f32>(0.5, 0.5);
    let i0 = vec2<i32>(i32(floor(sp.x)), i32(floor(sp.y)));
    let f = fract(sp);
    let c00 = ld(tex, i0);
    let c10 = ld(tex, i0 + vec2<i32>(1, 0));
    let c01 = ld(tex, i0 + vec2<i32>(0, 1));
    let c11 = ld(tex, i0 + vec2<i32>(1, 1));
    return mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y);
}

fn in_bounds(p: vec2<f32>) -> bool {
    return p.x > 0.0 && p.x < 1.0 && p.y > 0.0 && p.y < 1.0;
}

fn luma(c: vec3<f32>) -> f32 { return dot(c, vec3<f32>(0.299, 0.587, 0.114)); }

fn pixel_uv(gid: vec3<u32>) -> vec2<f32> {
    return (vec2<f32>(f32(gid.x), f32(gid.y)) + vec2<f32>(0.5, 0.5)) / dims();
}
`;

// ---- Wipe (direction + angle + gap/blur edge + gap color) -----------------
const WIPE_WGSL = `${WGSL_HEAD}
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= uni.width || gid.y >= uni.height) { return; }
    let coord = vec2<i32>(i32(gid.x), i32(gid.y));
    let uv = pixel_uv(gid);
    let aspect = dims().x / dims().y;
    let from_color = samp(from_tex, uv);
    let to_color = samp(to_tex, uv);

    let p = (uv - vec2<f32>(0.5, 0.5)) * vec2<f32>(aspect, 1.0);
    let progress = clamp(uni.progress, 0.0, 1.0);
    let axis = normalize(vec2<f32>(uni.p0, uni.p1));
    let gap_half = uni.p2 * 0.5;
    let max_dist = 0.5 * (aspect * abs(axis.x) + abs(axis.y));
    let axis_value = dot(p, axis);
    let edge = mix(-max_dist - gap_half, max_dist + gap_half, progress);
    let cut_start = edge - gap_half;
    let cut_end = edge + gap_half;
    let blur = max(uni.p3, 0.00001);
    let blur_mix = smoothstep(edge - blur, edge + blur, axis_value);

    var final_color: vec4<f32>;
    if (uni.p4 < 0.5) {
        // blur edge mode (applyToEdgeBlur is always true for shader transitions)
        final_color = mix(to_color, from_color, blur_mix);
    } else if (axis_value < cut_start) {
        final_color = to_color;
    } else if (axis_value > cut_end) {
        final_color = from_color;
    } else {
        final_color = vec4<f32>(uni.p5, uni.p6, uni.p7, 1.0);
    }
    textureStore(output_tex, coord, final_color);
}`;

// ---- Slide (axis, gap, gap color, motion blur, brightness/bloom) ----------
const SLIDE_WGSL = `${WGSL_HEAD}
fn slide_get(uv: vec2<f32>) -> vec4<f32> {
    let axis = vec2<f32>(uni.p0, uni.p1);
    let gap_vec = axis * uni.p2;
    let from_off = axis * uni.progress + gap_vec * 0.5;
    let to_off = axis * (uni.progress - 1.0) - gap_vec * 0.5;
    let from_uv = uv - from_off;
    let to_uv = uv - to_off;
    let from_in = from_uv.x >= 0.0 && from_uv.x <= 1.0 && from_uv.y >= 0.0 && from_uv.y <= 1.0;
    let to_in = to_uv.x >= 0.0 && to_uv.x <= 1.0 && to_uv.y >= 0.0 && to_uv.y <= 1.0;
    if (from_in) { return samp(from_tex, from_uv); }
    if (to_in) { return samp(to_tex, to_uv); }
    return vec4<f32>(uni.p3, uni.p4, uni.p5, 1.0);
}

fn slide_process(color: vec4<f32>) -> vec4<f32> {
    let env = sin(clamp(uni.progress, 0.0, 1.0) * PI);
    let brightness = uni.p10 * env;
    var extra = brightness;
    if (uni.p9 > 0.5) {
        let lum = dot(color.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
        extra = brightness * smoothstep(uni.p11, 1.0, lum);
    }
    return vec4<f32>(max(vec3<f32>(0.0), color.rgb * (1.0 + extra)), color.a);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= uni.width || gid.y >= uni.height) { return; }
    let coord = vec2<i32>(i32(gid.x), i32(gid.y));
    let uv = pixel_uv(gid);

    var final_color: vec4<f32>;
    // Scale motion blur by the curve's instantaneous speed, matching web rendering.
    let mb = uni.p6 * uni.speed;
    if (mb <= 0.0) {
        final_color = slide_process(slide_get(uv));
    } else {
        let max_samples = i32(uni.p7);
        let axis = vec2<f32>(uni.p0, uni.p1);
        // Scale sample count by pixel length of the blur
        let pixel_blur = mb * length(axis * dims());
        let samples = clamp(i32(ceil(pixel_blur)), 4, max_samples);
        let step_size = mb / f32(samples - 1);
        let start = -mb * 0.5;
        var accum = vec4<f32>(0.0);
        var tw = 0.0;
        for (var i = 0; i < 64; i = i + 1) {
            if (i >= samples) { break; }
            let off = start + f32(i) * step_size;
            let c = slide_process(slide_get(uv + axis * off));
            var w = 1.0;
            if (uni.p8 > 0.5) {
                let lum = dot(c.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
                w = smoothstep(uni.p11, 1.0, lum);
            }
            accum = accum + c * w;
            tw = tw + w;
        }
        if (tw > 0.0) { final_color = accum / tw; } else { final_color = slide_process(slide_get(uv)); }
    }
    textureStore(output_tex, coord, final_color);
}`;

// ---- Motion Blur (full-frame directional blur through a crossfade) --------
const MOTION_BLUR_WGSL = `${WGSL_HEAD}
fn motion_blur_process(color: vec4<f32>, envelope: f32) -> vec4<f32> {
    let brightness = uni.p5 * envelope;
    return vec4<f32>(max(vec3<f32>(0.0), color.rgb * (1.0 + brightness)), color.a);
}

fn motion_blur_sample(
    tex: texture_2d<f32>,
    uv: vec2<f32>,
    axis: vec2<f32>,
    amount: f32,
    envelope: f32
) -> vec4<f32> {
    if (amount <= 0.0) {
        return motion_blur_process(samp(tex, uv), envelope);
    }

    let max_samples = i32(uni.p3);
    let pixel_blur = amount * length(axis * dims());
    let samples = clamp(i32(ceil(pixel_blur)), 4, max_samples);
    let step_size = amount / f32(samples - 1);
    let start = -amount * 0.5;
    var accum = vec4<f32>(0.0);
    var total_weight = 0.0;

    for (var i = 0; i < 64; i = i + 1) {
        if (i >= samples) { break; }
        let offset = start + f32(i) * step_size;
        let color = motion_blur_process(samp(tex, uv + axis * offset), envelope);
        var weight = 1.0;
        if (uni.p4 > 0.5) {
            weight = smoothstep(uni.p6, 1.0, luma(color.rgb));
        }
        accum = accum + color * weight;
        total_weight = total_weight + weight;
    }

    if (total_weight > 0.0) {
        return accum / total_weight;
    }
    return motion_blur_process(samp(tex, uv), envelope);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= uni.width || gid.y >= uni.height) { return; }
    let coord = vec2<i32>(i32(gid.x), i32(gid.y));
    let uv = pixel_uv(gid);
    let progress = clamp(uni.progress, 0.0, 1.0);

    if (progress <= 0.0) {
        textureStore(output_tex, coord, samp(from_tex, uv));
        return;
    }
    if (progress >= 1.0) {
        textureStore(output_tex, coord, samp(to_tex, uv));
        return;
    }

    let envelope = sin(progress * PI);
    let amount = uni.p2 * uni.speed * envelope;
    let axis = normalize(vec2<f32>(uni.p0, uni.p1));
    let from_color = motion_blur_sample(from_tex, uv, axis, amount, envelope);
    let to_color = motion_blur_sample(to_tex, uv, -axis, amount, envelope);
    textureStore(output_tex, coord, mix(from_color, to_color, progress));
}`;

// ---- Clock (clockwise / counterclockwise / symmetric) ---------------------
const CLOCK_WGSL = `${WGSL_HEAD}
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= uni.width || gid.y >= uni.height) { return; }
    let coord = vec2<i32>(i32(gid.x), i32(gid.y));
    let uv = pixel_uv(gid);
    let centered = uv - vec2<f32>(0.5, 0.5);
    var angle = atan2(centered.x, -centered.y);
    if (angle < 0.0) { angle = angle + PI * 2.0; }
    if (uni.p0 < 0.0) {
        angle = PI * 2.0 - angle;
        if (angle >= PI * 2.0) { angle = angle - PI * 2.0; }
    } else if (uni.p0 > 1.5) {
        if (angle > PI) { angle = PI * 2.0 - angle; }
        angle = angle * 2.0;
    }
    let progress = clamp(uni.progress, 0.0, 1.0);
    let reveal = smoothstep(progress - 0.001, progress + 0.001, angle / (PI * 2.0));
    textureStore(output_tex, coord, mix(samp(from_tex, uv), samp(to_tex, uv), 1.0 - reveal));
}`;

// ---- Barn Door (angle, open/close, gap/blur edge, gap color, blur mode) ----
const BARN_DOOR_WGSL = `${WGSL_HEAD}
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= uni.width || gid.y >= uni.height) { return; }
    let coord = vec2<i32>(i32(gid.x), i32(gid.y));
    let uv = pixel_uv(gid);
    let from_color = samp(from_tex, uv);
    let to_color = samp(to_tex, uv);
    let aspect = dims().x / dims().y;
    let p = (uv - vec2<f32>(0.5, 0.5)) * vec2<f32>(aspect, 1.0);
    let progress = clamp(uni.progress, 0.0, 1.0);
    let axis = normalize(vec2<f32>(uni.p0, uni.p1));
    let gap_half = uni.p2 * 0.5;
    let dist = abs(dot(p, axis));
    let max_dist = 0.5 * (aspect * abs(axis.x) + abs(axis.y));

    let mode_open = uni.p8 > 0.5;
    let blur_scaled = uni.p9 > 0.5;
    var threshold: f32;
    var cur_blur: f32;
    if (mode_open) {
        threshold = max_dist * progress;
        cur_blur = select(uni.p3, uni.p3 * progress, blur_scaled);
    } else {
        threshold = max_dist * (1.0 - progress);
        cur_blur = select(uni.p3, uni.p3 * (1.0 - progress), blur_scaled);
    }
    let is_to_inside = mode_open;
    let cut_start = threshold - gap_half;
    let cut_end = threshold + gap_half;
    let blur = max(cur_blur, 0.00001);
    let blur_mix = smoothstep(threshold - blur, threshold + blur, dist);

    var final_color: vec4<f32>;
    if (uni.p4 < 0.5) {
        // blur edge mode (applyToEdgeBlur always true for shader transitions)
        if (is_to_inside) { final_color = mix(to_color, from_color, blur_mix); }
        else { final_color = mix(from_color, to_color, blur_mix); }
    } else if (dist < cut_start) {
        final_color = select(from_color, to_color, is_to_inside);
    } else if (dist > cut_end) {
        final_color = select(to_color, from_color, is_to_inside);
    } else {
        final_color = vec4<f32>(uni.p5, uni.p6, uni.p7, 1.0);
    }
    textureStore(output_tex, coord, final_color);
}`;

// ---- Blinds (alternating sliding strips, motion/post blur, brightness) -----
const BLINDS_WGSL = `${WGSL_HEAD}
fn blinds_get(uv: vec2<f32>) -> vec4<f32> {
    let strip_coord = dot(uv - vec2<f32>(0.5), vec2<f32>(uni.p2, uni.p3)) + 0.5;
    let strip_index = floor(strip_coord * uni.p4);
    let dir = select(-1.0, 1.0, (strip_index % 2.0) == 0.0);
    let mv = vec2<f32>(uni.p0, uni.p1) * dir;
    let from_uv = uv - mv * uni.progress;
    let to_uv = uv - mv * (uni.progress - 1.0);
    let from_in = from_uv.x >= 0.0 && from_uv.x <= 1.0 && from_uv.y >= 0.0 && from_uv.y <= 1.0;
    let to_in = to_uv.x >= 0.0 && to_uv.x <= 1.0 && to_uv.y >= 0.0 && to_uv.y <= 1.0;
    if (from_in) { return samp(from_tex, from_uv); }
    if (to_in) { return samp(to_tex, to_uv); }
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);
}

fn blinds_process(color: vec4<f32>) -> vec4<f32> {
    let env = sin(clamp(uni.progress, 0.0, 1.0) * PI);
    let brightness = uni.p10 * env;
    var extra = brightness;
    if (uni.p9 > 0.5) {
        let lum = dot(color.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
        extra = brightness * smoothstep(uni.p11, 1.0, lum);
    }
    return vec4<f32>(max(vec3<f32>(0.0), color.rgb * (1.0 + extra)), color.a);
}

fn blinds_motion(uv: vec2<f32>) -> vec4<f32> {
    // Scale motion blur by the curve's instantaneous speed, matching web rendering.
    let mb = uni.p7 * uni.speed;
    if (mb <= 0.0) { return blinds_process(blinds_get(uv)); }
    let max_samples = i32(uni.p6);
    let pixel_blur = mb * length(vec2<f32>(uni.p0, uni.p1) * dims());
    let samples = clamp(i32(ceil(pixel_blur)), 4, max_samples);
    let step_size = mb / f32(samples - 1);
    let start = -mb * 0.5;
    let strip_coord = dot(uv - vec2<f32>(0.5), vec2<f32>(uni.p2, uni.p3)) + 0.5;
    let strip_index = floor(strip_coord * uni.p4);
    let dir = select(-1.0, 1.0, (strip_index % 2.0) == 0.0);
    let blur_axis = vec2<f32>(uni.p0, uni.p1) * dir;
    var accum = vec4<f32>(0.0);
    var tw = 0.0;
    for (var i = 0; i < 64; i = i + 1) {
        if (i >= samples) { break; }
        let off = start + f32(i) * step_size;
        let c = blinds_process(blinds_get(uv + blur_axis * off));
        var w = 1.0;
        if (uni.p8 > 0.5) {
            let lum = dot(c.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
            w = smoothstep(uni.p11, 1.0, lum);
        }
        accum = accum + c * w;
        tw = tw + w;
    }
    if (tw > 0.0) { return accum / tw; }
    return blinds_process(blinds_get(uv));
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= uni.width || gid.y >= uni.height) { return; }
    let coord = vec2<i32>(i32(gid.x), i32(gid.y));
    let uv = pixel_uv(gid);
    let post_blur = uni.p5 * 0.005 * sin(clamp(uni.progress, 0.0, 1.0) * PI);

    if (post_blur <= 0.0) {
        textureStore(output_tex, coord, blinds_motion(uv));
        return;
    }

    let aspect = dims().x / dims().y;
    let blur_radius = vec2<f32>(post_blur, post_blur * aspect);
    var half_grid = 2;
    if (uni.p6 > 30.0) { half_grid = 4; }
    else if (uni.p6 > 15.0) { half_grid = 3; }
    else if (uni.p6 < 10.0) { half_grid = 1; }

    var accum = vec4<f32>(0.0);
    var tw = 0.0;
    for (var x = -4; x <= 4; x = x + 1) {
        if (x > half_grid) { break; }
        if (x < -half_grid) { continue; }
        for (var y = -4; y <= 4; y = y + 1) {
            if (y > half_grid) { break; }
            if (y < -half_grid) { continue; }
            let offset = vec2<f32>(f32(x), f32(y)) / f32(half_grid);
            accum = accum + blinds_motion(uv + offset * blur_radius);
            tw = tw + 1.0;
        }
    }
    textureStore(output_tex, coord, accum / tw);
}`;

// ---- Rectangle (reveal / zoom content mode, blur mode, anchor) ------------
const RECTANGLE_WGSL = `${WGSL_HEAD}
fn rect_distance(p: vec2<f32>, center: vec2<f32>, size: vec2<f32>) -> f32 {
    let d = abs(p - center) - size;
    return length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= uni.width || gid.y >= uni.height) { return; }
    let coord = vec2<i32>(i32(gid.x), i32(gid.y));
    let uv = pixel_uv(gid);
    let aspect = dims().x / dims().y;
    let progress = clamp(uni.progress, 0.0, 1.0);
    let dir_pos = uni.p2 > 0.0;
    let t = select(1.0 - progress, progress, dir_pos);
    let blur = max(0.0001, uni.p0 * select(1.0, t, uni.p1 > 0.5));
    let center = vec2<f32>(uni.p4, uni.p5);

    var reveal = 0.0;
    var uv_from = uv;
    var coord_to = uv;

    if (uni.p3 > 0.5) {
        let scale = max(0.0001, t);
        let uv_scaled = center + (uv - center) / scale;
        if (dir_pos) { coord_to = uv_scaled; } else { uv_from = uv_scaled; }
        let b_min = center - center * scale;
        let b_max = center + (vec2<f32>(1.0) - center) * scale;
        var pp = uv; pp.x = pp.x * aspect;
        var box_min = b_min; box_min.x = box_min.x * aspect;
        var box_max = b_max; box_max.x = box_max.x * aspect;
        let box_center = (box_min + box_max) * 0.5;
        let box_size = (box_max - box_min) * 0.5;
        let d = rect_distance(pp, box_center, box_size);
        reveal = 1.0 - smoothstep(-blur, blur, d);
        if (!dir_pos) { reveal = 1.0 - reveal; }
    } else {
        var centered = uv - center; centered.x = centered.x * aspect;
        let max_x = max(center.x, 1.0 - center.x) * aspect;
        let max_y = max(center.y, 1.0 - center.y);
        let cur_size = vec2<f32>(max_x, max_y) * t;
        let d = rect_distance(centered, vec2<f32>(0.0), cur_size);
        reveal = 1.0 - smoothstep(-blur, blur, d);
        if (!dir_pos) { reveal = 1.0 - reveal; }
    }

    let from_color = samp(from_tex, uv_from);
    let to_color = samp(to_tex, coord_to);
    textureStore(output_tex, coord, mix(from_color, to_color, reveal));
}`;

// ---- Circle / Ellipse (scale, blur mode, anchor, follow scale) ------------
const ELLIPSE_WGSL = `${WGSL_HEAD}
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= uni.width || gid.y >= uni.height) { return; }
    let coord = vec2<i32>(i32(gid.x), i32(gid.y));
    let uv = pixel_uv(gid);
    let aspect = dims().x / dims().y;
    let center = vec2<f32>(uni.p3, uni.p4);
    let scale = max(vec2<f32>(0.001), vec2<f32>(uni.p5, uni.p6));

    var centered = uv - center; centered.x = centered.x * aspect; centered = centered / scale;
    let dist = length(centered);

    var c0 = vec2<f32>(0.0, 0.0) - center; c0.x = c0.x * aspect; c0 = c0 / scale;
    var c1 = vec2<f32>(1.0, 0.0) - center; c1.x = c1.x * aspect; c1 = c1 / scale;
    var c2 = vec2<f32>(0.0, 1.0) - center; c2.x = c2.x * aspect; c2 = c2 / scale;
    var c3 = vec2<f32>(1.0, 1.0) - center; c3.x = c3.x * aspect; c3 = c3 / scale;
    let max_radius = max(max(length(c0), length(c1)), max(length(c2), length(c3)));

    let progress = clamp(uni.progress, 0.0, 1.0);
    let dir_pos = uni.p2 > 0.0;
    let t = select(1.0 - progress, progress, dir_pos);
    let radius = t * max_radius;
    let blur = max(0.0001, uni.p0 * select(1.0, t, uni.p1 > 0.5));
    var reveal = 1.0 - smoothstep(radius - blur, radius + blur, dist);
    if (!dir_pos) { reveal = 1.0 - reveal; }

    var uv_from = uv;
    var norm_to = uv;
    if (uni.p7 > 0.5) {
        let s = min(1.0, radius * 2.0);
        if (dir_pos) { norm_to = (norm_to - center) / max(0.0001, s) + center; }
        else { uv_from = (uv_from - center) / max(0.0001, s) + center; }
    }

    let from_color = samp(from_tex, uv_from);
    let to_color = samp(to_tex, norm_to);
    textureStore(output_tex, coord, mix(from_color, to_color, reveal));
}`;

// ---- Zoom (scale + rotation + radial blur + bloom) ------------------------
const ZOOM_WGSL = `${WGSL_HEAD}
fn zoom_rotate(pt: vec2<f32>, angle: f32, aspect: f32) -> vec2<f32> {
    let c = cos(angle);
    let s = sin(angle);
    let x = pt.x * aspect;
    var r = vec2<f32>(x * c - pt.y * s, x * s + pt.y * c);
    r.x = r.x / aspect;
    return r;
}

fn zoom_sample(tex: texture_2d<f32>, uv: vec2<f32>, blur_amount: f32, bright: f32, blur_fade: f32) -> vec4<f32> {
    let orig = samp(tex, uv);
    let max_samples = uni.p4;
    let dir = vec2<f32>(0.5, 0.5) - uv;
    let pixel_blur = blur_amount * length(dir * dims());
    let samples = clamp(ceil(pixel_blur), 4.0, max_samples);
    if (uni.p5 < 0.5) {
        if (blur_amount < 0.001) { return vec4<f32>(orig.rgb * bright, orig.a); }
        var sum = vec4<f32>(0.0);
        for (var i = 0.0; i < 64.0; i = i + 1.0) {
            if (i >= samples) { break; }
            let t = i / max(samples - 1.0, 1.0);
            sum = sum + samp(tex, uv + dir * (t * blur_amount));
        }
        let blurred = sum / samples;
        return vec4<f32>(blurred.rgb * bright, blurred.a);
    }
    // bloom mode
    if (blur_amount < 0.001) {
        let lum = luma(orig.rgb);
        let boost = smoothstep(0.4, 1.0, lum) * (bright - 1.0);
        return vec4<f32>(orig.rgb + orig.rgb * boost, orig.a);
    }
    var bloom_sum = vec4<f32>(0.0);
    for (var i = 0.0; i < 64.0; i = i + 1.0) {
        if (i >= samples) { break; }
        let t = i / max(samples - 1.0, 1.0);
        let sc = samp(tex, uv + dir * (t * blur_amount));
        bloom_sum = bloom_sum + sc * smoothstep(0.4, 1.0, luma(sc.rgb));
    }
    let bloom_color = bloom_sum / samples;
    let lum = luma(orig.rgb);
    let boost = smoothstep(0.4, 1.0, lum) * (bright - 1.0);
    let extra = (bright - 1.0) * 2.0;
    let rgb = orig.rgb + orig.rgb * boost + bloom_color.rgb * blur_fade * (1.0 + extra);
    return vec4<f32>(rgb, orig.a);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= uni.width || gid.y >= uni.height) { return; }
    let coord = vec2<i32>(i32(gid.x), i32(gid.y));
    let uv = pixel_uv(gid);
    let aspect = dims().x / dims().y;
    let progress = clamp(uni.progress, 0.0, 1.0);

    let from_scale = mix(1.0, uni.p0, progress);
    let from_angle = mix(0.0, uni.p1, progress);
    let from_blur = mix(0.0, uni.p3 * 0.005, progress);
    let from_bright = mix(1.0, 1.0 + uni.p6, progress);
    var from_c = zoom_rotate(uv - vec2<f32>(0.5), from_angle, aspect);
    let from_uv = from_c / from_scale + vec2<f32>(0.5);
    var from_color = zoom_sample(from_tex, from_uv, from_blur, from_bright, progress);
    let from_inside = step(0.0, from_uv.x) * step(from_uv.x, 1.0) * step(0.0, from_uv.y) * step(from_uv.y, 1.0);
    from_color = from_color * ((1.0 - progress) * from_inside);

    let to_scale = mix(uni.p0, 1.0, progress);
    let to_angle = mix(uni.p2, 0.0, progress);
    let to_blur = mix(uni.p3 * 0.005, 0.0, progress);
    let to_bright = mix(1.0 + uni.p6, 1.0, progress);
    var to_c = zoom_rotate(uv - vec2<f32>(0.5), to_angle, aspect);
    let to_uv = to_c / to_scale + vec2<f32>(0.5);
    var to_color = zoom_sample(to_tex, to_uv, to_blur, to_bright, 1.0 - progress);
    let to_inside = step(0.0, to_uv.x) * step(to_uv.x, 1.0) * step(0.0, to_uv.y) * step(to_uv.y, 1.0);
    to_color = to_color * (progress * to_inside);

    let result = from_color + to_color;
    textureStore(output_tex, coord, vec4<f32>(result.rgb, min(result.a, 1.0)));
}`;

// ---- Bloom (3x3 weighted blur, bright extraction) -------------------------
const BLOOM_WGSL = `${WGSL_HEAD}
fn extract_bright(color: vec4<f32>) -> vec4<f32> {
    let l = luma(color.rgb);
    return color * smoothstep(0.5, 0.7, l);
}

fn bloom_tap(tex: texture_2d<f32>, uv: vec2<f32>, is_bloom: bool) -> vec4<f32> {
    let c = samp(tex, uv);
    if (is_bloom) { return extract_bright(c); }
    return c;
}

fn bloom_sample(tex: texture_2d<f32>, uv: vec2<f32>, ba: f32, is_bloom: bool) -> vec4<f32> {
    let samples = clamp(i32(uni.p3), 5, 25);
    var sum = vec4<f32>(0.0);
    for (var i = 0; i < 25; i = i + 1) {
        if (i >= samples) { break; }
        let fi = f32(i);
        let radius = sqrt((fi + 0.5) / f32(samples)) * ba;
        let angle = fi * 2.3999632;
        let offset = vec2<f32>(cos(angle), sin(angle)) * radius;
        sum = sum + bloom_tap(tex, uv + offset, is_bloom);
    }
    return sum / f32(samples);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= uni.width || gid.y >= uni.height) { return; }
    let coord = vec2<i32>(i32(gid.x), i32(gid.y));
    let uv = pixel_uv(gid);
    let progress = clamp(uni.progress, 0.0, 1.0);
    let from_color = samp(from_tex, uv);
    let to_color = samp(to_tex, uv);
    let base = mix(from_color, to_color, progress);
    let peak = 1.0 - abs(progress - 0.5) * 2.0;
    let ba = uni.p1 * peak * 0.05;
    let is_bloom = uni.p2 > 0.5;

    let bf = bloom_sample(from_tex, uv, ba, is_bloom);
    let bt = bloom_sample(to_tex, uv, ba, is_bloom);
    var out_color: vec4<f32>;
    if (is_bloom) {
        let mixed = mix(bf, bt, progress);
        out_color = base + mixed * uni.p0 * peak;
    } else {
        let mixed = mix(bf, bt, progress);
        out_color = mixed * mix(1.0, uni.p0, peak);
    }
    textureStore(output_tex, coord, vec4<f32>(min(out_color.rgb, vec3<f32>(1.0)), base.a));
}`;

// ---- Cube (true perspective cube rotation) --------------------------------
const CUBE_WGSL = `${WGSL_HEAD}
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= uni.width || gid.y >= uni.height) { return; }
    let coord = vec2<i32>(i32(gid.x), i32(gid.y));
    let uv = pixel_uv(gid);
    let progress = clamp(uni.progress, 0.0, 1.0);

    let unzoom = 0.3 * uni.p2;
    let uz = unzoom * 2.0 * (0.5 - abs(progress - 0.5));
    let p = vec2<f32>(-uz * 0.5) + (1.0 + uz) * uv;

    var from_p = vec2<f32>(-1.0);
    var to_p = vec2<f32>(-1.0);
    let cap_p = mix(1.0, uni.p3, sin(progress * PI));
    let gap_half = uni.p4 * 0.5;
    let dx = uni.p0;
    let dy = uni.p1;

    if (dx < -0.5) {
        let bound = 1.0 - progress;
        let from_bound = bound - gap_half;
        let to_bound = bound + gap_half;
        let from_w = max(0.0001, from_bound);
        let to_w = max(0.0001, 1.0 - to_bound);
        if (p.x <= from_bound) {
            let u = p.x / from_w;
            let h = mix(1.0, cap_p, u);
            from_p = vec2<f32>(u, (p.y - 0.5) / h + 0.5);
        } else if (p.x >= to_bound) {
            let u = (p.x - to_bound) / to_w;
            let h = mix(cap_p, 1.0, u);
            to_p = vec2<f32>(u, (p.y - 0.5) / h + 0.5);
        }
    } else if (dx > 0.5) {
        let bound = progress;
        let to_bound = bound - gap_half;
        let from_bound = bound + gap_half;
        let to_w = max(0.0001, to_bound);
        let from_w = max(0.0001, 1.0 - from_bound);
        if (p.x <= to_bound) {
            let u = p.x / to_w;
            let h = mix(1.0, cap_p, u);
            to_p = vec2<f32>(u, (p.y - 0.5) / h + 0.5);
        } else if (p.x >= from_bound) {
            let u = (p.x - from_bound) / from_w;
            let h = mix(cap_p, 1.0, u);
            from_p = vec2<f32>(u, (p.y - 0.5) / h + 0.5);
        }
    } else if (dy < -0.5) {
        let bound = 1.0 - progress;
        let from_bound = bound - gap_half;
        let to_bound = bound + gap_half;
        let from_w = max(0.0001, from_bound);
        let to_w = max(0.0001, 1.0 - to_bound);
        if (p.y <= from_bound) {
            let u = p.y / from_w;
            let h = mix(1.0, cap_p, u);
            from_p = vec2<f32>((p.x - 0.5) / h + 0.5, u);
        } else if (p.y >= to_bound) {
            let u = (p.y - to_bound) / to_w;
            let h = mix(cap_p, 1.0, u);
            to_p = vec2<f32>((p.x - 0.5) / h + 0.5, u);
        }
    } else {
        let bound = progress;
        let to_bound = bound - gap_half;
        let from_bound = bound + gap_half;
        let to_w = max(0.0001, to_bound);
        let from_w = max(0.0001, 1.0 - from_bound);
        if (p.y <= to_bound) {
            let u = p.y / to_w;
            let h = mix(1.0, cap_p, u);
            to_p = vec2<f32>((p.x - 0.5) / h + 0.5, u);
        } else if (p.y >= from_bound) {
            let u = (p.y - from_bound) / from_w;
            let h = mix(cap_p, 1.0, u);
            from_p = vec2<f32>((p.x - 0.5) / h + 0.5, u);
        }
    }

    var color = vec4<f32>(0.0);
    if (in_bounds(from_p)) { color = samp(from_tex, from_p); }
    else if (in_bounds(to_p)) { color = samp(to_tex, to_p); }
    textureStore(output_tex, coord, color);
}`;

// ---- Card Swap (zoom / slide perspective cards with shadow + bloom) -------
const CARD_SWAP_WGSL = `${WGSL_HEAD}
fn card_blur_slide(tex: texture_2d<f32>, pos: vec2<f32>, blur_dir: vec2<f32>, blur_amount: f32, samples: i32, f_samples: f32, dark: f32) -> vec4<f32> {
    var c = vec4<f32>(0.0);
    var tw = 0.0;
    for (var i = 0; i < 64; i = i + 1) {
        if (i >= samples) { break; }
        let off = (f32(i) / (f_samples - 1.0) - 0.5) * blur_amount;
        let sc = samp(tex, pos + blur_dir * off);
        let w = 1.0 + pow(luma(sc.rgb), 2.0) * uni.p8 * 5.0;
        c = c + sc * w;
        tw = tw + w;
    }
    c = c / tw;
    c = vec4<f32>(c.rgb + c.rgb * max(0.0, luma(c.rgb) - 0.5) * uni.p8 * 2.0, c.a);
    return vec4<f32>(c.rgb * (1.0 - dark), c.a);
}

fn card_blur_radial(tex: texture_2d<f32>, pos: vec2<f32>, blur_amount: f32, samples: i32, f_samples: f32, dark: f32) -> vec4<f32> {
    var c = vec4<f32>(0.0);
    var tw = 0.0;
    for (var i = 0; i < 64; i = i + 1) {
        if (i >= samples) { break; }
        let fi = f32(i);
        let off = vec2<f32>(cos(fi * 2.39996) * blur_amount, sin(fi * 2.39996) * blur_amount) * (fi / f_samples);
        let sc = samp(tex, pos + off);
        let w = 1.0 + pow(luma(sc.rgb), 2.0) * uni.p8 * 5.0;
        c = c + sc * w;
        tw = tw + w;
    }
    c = c / tw;
    c = vec4<f32>(c.rgb + c.rgb * max(0.0, luma(c.rgb) - 0.5) * uni.p8 * 2.0, c.a);
    return vec4<f32>(c.rgb * (1.0 - dark), c.a);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= uni.width || gid.y >= uni.height) { return; }
    let coord = vec2<i32>(i32(gid.x), i32(gid.y));
    let progress = clamp(uni.progress, 0.0, 1.0);
    let depth = 3.0;
    let perspective = 0.2;

    let dir_h = uni.p0 > 0.5;
    let mode_slide = uni.p1 > 0.5;
    let order_rev = uni.p2 > 0.5;
    let sign_order = select(1.0, -1.0, order_rev);

    var p = pixel_uv(gid);
    if (sign_order < 0.0) {
        if (dir_h) { p.x = 1.0 - p.x; } else { p.y = 1.0 - p.y; }
    }

    var pfr = vec2<f32>(-1.0);
    var pto = vec2<f32>(-1.0);
    var size_fr = 1.0;
    var size_to = 1.0;
    var dark_fr = 0.0;
    var dark_to = 0.0;

    if (mode_slide) {
        let dirv = select(vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), dir_h);
        let mag = select(1.0 - progress, progress, progress < 0.5);
        pfr = p + dirv * mag;
        pto = p - dirv * mag;
        dark_fr = select(uni.p3 * (2.0 * progress - 1.0), 0.0, progress < 0.5);
        dark_to = select(0.0, uni.p3 * (1.0 - 2.0 * progress), progress < 0.5);
    } else {
        size_fr = mix(1.0, depth, progress);
        let persp_fr = perspective * progress;
        size_to = mix(1.0, depth, 1.0 - progress);
        let persp_to = perspective * (1.0 - progress);
        dark_fr = uni.p3 * progress;
        dark_to = uni.p3 * (1.0 - progress);
        if (dir_h) {
            pfr = (p + vec2<f32>(0.0, -0.5)) * vec2<f32>(size_fr / (1.0 - perspective * progress), size_fr / (1.0 - size_fr * persp_fr * p.x)) + vec2<f32>(0.0, 0.5);
            pto = (p + vec2<f32>(-1.0, -0.5)) * vec2<f32>(size_to / (1.0 - perspective * (1.0 - progress)), size_to / (1.0 - size_to * persp_to * (1.0 - p.x))) + vec2<f32>(1.0, 0.5);
        } else {
            pfr = (p + vec2<f32>(-0.5, 0.0)) * vec2<f32>(size_fr / (1.0 - size_fr * persp_fr * p.y), size_fr / (1.0 - perspective * progress)) + vec2<f32>(0.5, 0.0);
            pto = (p + vec2<f32>(-0.5, -1.0)) * vec2<f32>(size_to / (1.0 - size_to * persp_to * (1.0 - p.y)), size_to / (1.0 - perspective * (1.0 - progress))) + vec2<f32>(0.5, 1.0);
        }
    }

    if (sign_order < 0.0) {
        if (dir_h) { pfr.x = 1.0 - pfr.x; pto.x = 1.0 - pto.x; }
        else { pfr.y = 1.0 - pfr.y; pto.y = 1.0 - pto.y; }
    }

    let pfr_in = in_bounds(pfr);
    let pto_in = in_bounds(pto);

    var shadow_fr = 0.0;
    if (!pfr_in && uni.p4 > 0.0 && uni.p5 > 0.0) {
        let d2 = max(vec2<f32>(0.0) - pfr, pfr - vec2<f32>(1.0));
        let dist = length(max(d2, vec2<f32>(0.0))) / size_fr;
        let max_d = uni.p4 * 0.2;
        if (dist < max_d && max_d > 0.0) { shadow_fr = (1.0 - dist / max_d) * uni.p5; }
    }
    var shadow_to = 0.0;
    if (!pto_in && uni.p4 > 0.0 && uni.p5 > 0.0) {
        let d2 = max(vec2<f32>(0.0) - pto, pto - vec2<f32>(1.0));
        let dist = length(max(d2, vec2<f32>(0.0))) / size_to;
        let max_d = uni.p4 * 0.2;
        if (dist < max_d && max_d > 0.0) { shadow_to = (1.0 - dist / max_d) * uni.p5; }
    }

    let max_samples = i32(uni.p7);
    var final_c_fr = vec4<f32>(0.0);
    var final_c_to = vec4<f32>(0.0);

    if (mode_slide) {
        let blur_dir = select(vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), dir_h);
        let blur_amount = uni.p6 * 0.1;
        // Scale sample count by pixel blur length
        let pixel_blur = blur_amount * length(blur_dir * dims());
        let samples = clamp(i32(ceil(pixel_blur)), 4, max_samples);
        let f_samples = f32(samples);
        if (pfr_in) { final_c_fr = card_blur_slide(from_tex, pfr, blur_dir, blur_amount, samples, f_samples, dark_fr); }
        if (pto_in) { final_c_to = card_blur_slide(to_tex, pto, blur_dir, blur_amount, samples, f_samples, dark_to); }
    } else {
        let blur_fr = uni.p6 * (size_fr - 1.0) * 0.02;
        let blur_to = uni.p6 * (size_to - 1.0) * 0.02;
        let samples_fr = clamp(i32(ceil(blur_fr * max(dims().x, dims().y))), 4, max_samples);
        let samples_to = clamp(i32(ceil(blur_to * max(dims().x, dims().y))), 4, max_samples);
        if (pfr_in) { final_c_fr = card_blur_radial(from_tex, pfr, blur_fr, samples_fr, f32(samples_fr), dark_fr); }
        if (pto_in) { final_c_to = card_blur_radial(to_tex, pto, blur_to, samples_to, f32(samples_to), dark_to); }
    }

    var final_color = vec4<f32>(0.0);
    if (progress < 0.5) {
        if (pfr_in) {
            final_color = final_c_fr;
        } else if (pto_in) {
            let total_dark = min(1.0, dark_to + shadow_fr);
            final_color = vec4<f32>(final_c_to.rgb * (1.0 - total_dark) / max(1.0 - dark_to, 0.001), final_c_to.a);
        }
    } else {
        if (pto_in) {
            final_color = final_c_to;
        } else if (pfr_in) {
            let total_dark = min(1.0, dark_fr + shadow_to);
            final_color = vec4<f32>(final_c_fr.rgb * (1.0 - total_dark) / max(1.0 - dark_fr, 0.001), final_c_fr.a);
        }
    }
    textureStore(output_tex, coord, final_color);
}`;

// ---- Falling Card (3D card fall/rise with perspective + depth) ------------
const FALLING_CARD_WGSL = `${WGSL_HEAD}
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= uni.width || gid.y >= uni.height) { return; }
    let coord = vec2<i32>(i32(gid.x), i32(gid.y));
    let uv = pixel_uv(gid);
    let progress = clamp(uni.progress, 0.0, 1.0);
    let to_color = samp(to_tex, uv);
    let from_color = samp(from_tex, uv);

    if (progress >= 1.0) { textureStore(output_tex, coord, to_color); return; }
    if (progress <= 0.0) { textureStore(output_tex, coord, from_color); return; }

    let is_rise = uni.p2 > 0.5;
    let anim = select(progress, 1.0 - progress, is_rise);
    let angle = anim * PI / 2.0;
    let c = cos(angle);
    let s = sin(angle);
    let dd = uni.p1;
    let d = 1.5;
    let z_base = select(0.0, s * 0.8, dd < 0.0);
    let dir = uni.p0;

    var p_moved = vec2<f32>(-1.0);
    var denom = 1.0;

    if (dir < 0.5) {
        let p = uv - vec2<f32>(0.5, 0.0);
        denom = d * c - dd * p.y * s;
        if (denom > 0.0) {
            let py = p.y * (d + z_base) / denom;
            let z = z_base + dd * py * s;
            let px = p.x * (d + z) / d;
            p_moved = vec2<f32>(px, py) + vec2<f32>(0.5, 0.0);
        }
    } else if (dir < 1.5) {
        let p = uv - vec2<f32>(0.5, 1.0);
        denom = d * c + dd * p.y * s;
        if (denom > 0.0) {
            let py = p.y * (d + z_base) / denom;
            let z = z_base + dd * (-py) * s;
            let px = p.x * (d + z) / d;
            p_moved = vec2<f32>(px, py) + vec2<f32>(0.5, 1.0);
        }
    } else if (dir < 2.5) {
        let p = uv - vec2<f32>(0.0, 0.5);
        denom = d * c - dd * p.x * s;
        if (denom > 0.0) {
            let px = p.x * (d + z_base) / denom;
            let z = z_base + dd * px * s;
            let py = p.y * (d + z) / d;
            p_moved = vec2<f32>(px, py) + vec2<f32>(0.0, 0.5);
        }
    } else {
        let p = uv - vec2<f32>(1.0, 0.5);
        denom = d * c + dd * p.x * s;
        if (denom > 0.0) {
            let px = p.x * (d + z_base) / denom;
            let z = z_base + dd * (-px) * s;
            let py = p.y * (d + z) / d;
            p_moved = vec2<f32>(px, py) + vec2<f32>(1.0, 0.5);
        }
    }

    if (denom <= 0.0) {
        textureStore(output_tex, coord, select(to_color, from_color, is_rise));
        return;
    }

    var final_color: vec4<f32>;
    if (in_bounds(p_moved)) {
        if (is_rise) {
            let moving = samp(to_tex, p_moved);
            let out_a = moving.a + from_color.a * (1.0 - moving.a);
            if (out_a > 0.0) {
                let rgb = (moving.rgb * moving.a + from_color.rgb * from_color.a * (1.0 - moving.a)) / out_a;
                final_color = vec4<f32>(rgb * out_a, out_a);
            } else { final_color = vec4<f32>(0.0); }
        } else {
            let moving = samp(from_tex, p_moved);
            let out_a = moving.a + to_color.a * (1.0 - moving.a);
            if (out_a > 0.0) {
                let rgb = (moving.rgb * moving.a + to_color.rgb * to_color.a * (1.0 - moving.a)) / out_a;
                final_color = vec4<f32>(rgb * out_a, out_a);
            } else { final_color = vec4<f32>(0.0); }
        }
    } else {
        final_color = select(to_color, from_color, is_rise);
    }
    textureStore(output_tex, coord, final_color);
}`;

// ---------------------------------------------------------------------------
// Reusable param-field fragments (label keys match the web manifests / i18n).
// ---------------------------------------------------------------------------

const blurQualityField = {
  kind: 'select' as const,
  key: 'blurQuality',
  labelKey: 'fastcat.timeline.transition.paramBlurQuality',
  options: [
    { value: 'low', labelKey: 'fastcat.timeline.transition.blurQualityLow' },
    { value: 'medium', labelKey: 'fastcat.timeline.transition.blurQualityMedium' },
    { value: 'high', labelKey: 'fastcat.timeline.transition.blurQualityHigh' },
    { value: 'ultra', labelKey: 'fastcat.timeline.transition.blurQualityUltra' },
  ],
};

const anchorField = {
  kind: 'select' as const,
  key: 'anchor',
  labelKey: 'fastcat.timeline.transition.paramAnchor',
  options: [
    { value: 'center', labelKey: 'fastcat.timeline.transition.anchorCenter' },
    { value: 'top-left', labelKey: 'fastcat.timeline.transition.anchorTopLeft' },
    { value: 'top-right', labelKey: 'fastcat.timeline.transition.anchorTopRight' },
    { value: 'bottom-left', labelKey: 'fastcat.timeline.transition.anchorBottomLeft' },
    { value: 'bottom-right', labelKey: 'fastcat.timeline.transition.anchorBottomRight' },
  ],
};

const fromToCenterField = {
  kind: 'select' as const,
  key: 'direction',
  labelKey: 'fastcat.timeline.transition.paramDirection',
  options: [
    { value: 'from-center', labelKey: 'fastcat.timeline.transition.directionFromCenter' },
    { value: 'to-center', labelKey: 'fastcat.timeline.transition.directionToCenter' },
  ],
};

const blurModeField = {
  kind: 'button-group' as const,
  key: 'blurMode',
  labelKey: 'fastcat.timeline.transition.paramBlurMode',
  options: [
    { value: 'fixed', labelKey: 'fastcat.timeline.transition.blurModeFixed' },
    { value: 'scaled', labelKey: 'fastcat.timeline.transition.blurModeScaled' },
  ],
};

const offsetFields = [
  {
    kind: 'number' as const,
    key: 'offsetX',
    labelKey: 'fastcat.timeline.transition.paramOffsetX',
    min: -100,
    max: 100,
    step: 1,
  },
  {
    kind: 'number' as const,
    key: 'offsetY',
    labelKey: 'fastcat.timeline.transition.paramOffsetY',
    min: -100,
    max: 100,
    step: 1,
  },
];

// ---------------------------------------------------------------------------
// Manifests.
// ---------------------------------------------------------------------------

export const tauriTransitionManifests: TransitionManifest[] = [
  {
    type: 'dissolve',
    name: 'Dissolve',
    nameKey: 'fastcat.transitions.dissolve.name',
    icon: 'i-heroicons-arrows-right-left',
    defaultDurationUs: 500_000,
    defaultParams: {},
    renderMode: 'shader',
    renderer: 'wgpu',
    supportedModes: ['adjacent', 'background', 'transparent'],
    toTauriSpec: () => ({ type: 'crossfade' }),
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
  {
    type: 'wipe',
    name: 'Wipe',
    nameKey: 'fastcat.transitions.wipe.name',
    icon: 'i-heroicons-bars-3-bottom-left',
    defaultDurationUs: 500_000,
    defaultParams: {
      direction: 'left',
      edgeMode: 'gap',
      gap: 0.02,
      gapColor: '#000000',
      blur: 2,
      angle: 0,
    },
    renderMode: 'shader',
    renderer: 'wgpu',
    supportedModes: ['adjacent'],
    paramFields: [
      {
        kind: 'select',
        key: 'direction',
        labelKey: 'fastcat.timeline.transition.paramDirection',
        options: [
          { value: 'left', labelKey: 'fastcat.timeline.transition.directionLeft' },
          { value: 'right', labelKey: 'fastcat.timeline.transition.directionRight' },
          { value: 'up', labelKey: 'fastcat.timeline.transition.directionUp' },
          { value: 'down', labelKey: 'fastcat.timeline.transition.directionDown' },
        ],
      },
      {
        kind: 'button-group',
        key: 'edgeMode',
        labelKey: 'fastcat.timeline.transition.paramWipeEdgeMode',
        options: [
          { value: 'gap', labelKey: 'fastcat.timeline.transition.wipeEdgeModeGap' },
          { value: 'blur', labelKey: 'fastcat.timeline.transition.wipeEdgeModeBlur' },
        ],
      },
      {
        kind: 'number',
        key: 'gap',
        labelKey: 'fastcat.timeline.transition.paramGapSize',
        min: 0,
        max: 0.2,
        step: 0.005,
      },
      { kind: 'color', key: 'gapColor', labelKey: 'fastcat.timeline.transition.paramGapColor' },
      {
        kind: 'number',
        key: 'blur',
        labelKey: 'fastcat.timeline.transition.paramWipeEdgeBlur',
        min: 0,
        max: 20,
        step: 0.5,
      },
      {
        kind: 'number',
        key: 'angle',
        labelKey: 'fastcat.timeline.transition.paramAngle',
        min: -180,
        max: 180,
        step: 1,
      },
    ],
    toTauriSpec: (params: Record<string, unknown>) => {
      const useGap = params.edgeMode !== 'blur';
      const [ax, ay] = wipeAxis(params.direction, clamp(finiteNumber(params.angle, 0), -180, 180));
      const [r, g, b] = hexToRgb01(params.gapColor, '#000000');
      return {
        type: 'custom-wgsl',
        source: WIPE_WGSL,
        params: {
          p0: ax,
          p1: ay,
          p2: useGap ? clamp(finiteNumber(params.gap, 0.02), 0, 0.2) : 0,
          p3: clamp(finiteNumber(params.blur, 2) / 100, 0.0001, 0.2),
          p4: useGap ? 1 : 0,
          p5: r,
          p6: g,
          p7: b,
        },
      };
    },
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
  {
    type: 'slide',
    name: 'Slide',
    nameKey: 'fastcat.transitions.slide.name',
    icon: 'i-heroicons-arrows-right-left',
    defaultDurationUs: 500_000,
    defaultParams: {
      direction: 'left',
      gap: 0.02,
      gapColor: '#000000',
      motionBlur: 0,
      motionBlurMode: 'normal',
      blurQuality: 'medium',
      brightnessMode: 'normal',
      brightness: 0,
      bloomThreshold: 0.7,
    },
    renderMode: 'shader',
    renderer: 'wgpu',
    supportedModes: ['adjacent'],
    paramFields: [
      {
        kind: 'select',
        key: 'direction',
        labelKey: 'fastcat.timeline.transition.paramDirection',
        options: [
          { value: 'left', labelKey: 'fastcat.transitions.slide.options.left' },
          { value: 'right', labelKey: 'fastcat.transitions.slide.options.right' },
          { value: 'up', labelKey: 'fastcat.transitions.slide.options.up' },
          { value: 'down', labelKey: 'fastcat.transitions.slide.options.down' },
        ],
      },
      {
        kind: 'number',
        key: 'gap',
        labelKey: 'fastcat.timeline.transition.paramGapSize',
        min: 0,
        max: 0.2,
        step: 0.005,
      },
      { kind: 'color', key: 'gapColor', labelKey: 'fastcat.timeline.transition.paramGapColor' },
      {
        kind: 'number',
        key: 'motionBlur',
        labelKey: 'fastcat.timeline.transition.paramMotionBlur',
        min: 0,
        max: 10,
        step: 0.1,
      },
      {
        kind: 'button-group',
        key: 'motionBlurMode',
        labelKey: 'fastcat.timeline.transition.paramMotionBlurMode',
        options: [
          { value: 'normal', labelKey: 'fastcat.timeline.transition.motionBlurModeNormal' },
          { value: 'bloom', labelKey: 'fastcat.timeline.transition.motionBlurModeBloom' },
        ],
      },
      {
        kind: 'button-group',
        key: 'brightnessMode',
        labelKey: 'fastcat.timeline.transition.paramBrightnessMode',
        options: [
          { value: 'normal', labelKey: 'fastcat.timeline.transition.brightnessModeNormal' },
          { value: 'bloom', labelKey: 'fastcat.timeline.transition.brightnessModeBloom' },
        ],
      },
      {
        kind: 'number',
        key: 'brightness',
        labelKey: 'fastcat.timeline.transition.paramBrightness',
        min: -10,
        max: 10,
        step: 0.1,
      },
      {
        kind: 'number',
        key: 'bloomThreshold',
        labelKey: 'fastcat.timeline.transition.paramBloomThreshold',
        min: 0,
        max: 1,
        step: 0.01,
      },
    ],
    toTauriSpec: (
      params: Record<string, unknown>,
      durationSec?: number,
      options?: { isExport?: boolean; isPlaying?: boolean; previewBlurQuality?: string },
    ): TauriTransitionSpec => {
      const [ax, ay] = directionVector(params.direction);
      const [r, g, b] = hexToRgb01(params.gapColor, '#000000');
      const q = resolveBlurQuality(options, params.blurQuality);
      const samples = qualitySamples(q, 8, 16, 32, 64);
      return {
        type: 'custom-wgsl',
        source: SLIDE_WGSL,
        params: {
          p0: ax,
          p1: ay,
          p2: clamp(finiteNumber(params.gap, 0.02), 0, 0.2),
          p3: r,
          p4: g,
          p5: b,
          p6: motionBlurConst(clamp(finiteNumber(params.motionBlur, 0), 0, 10), durationSec),
          p7: samples,
          p8: params.motionBlurMode === 'bloom' ? 1 : 0,
          p9: params.brightnessMode === 'bloom' ? 1 : 0,
          p10: clamp(finiteNumber(params.brightness, 0), -10, 10),
          p11: clamp(finiteNumber(params.bloomThreshold, 0.7), 0, 1),
        },
      };
    },
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
  {
    type: 'clock',
    name: 'Clock',
    nameKey: 'fastcat.transitions.clock.name',
    icon: 'i-heroicons-clock',
    defaultDurationUs: 600_000,
    defaultParams: normalizeClockParams(),
    normalizeParams: normalizeClockParams,
    renderMode: 'shader',
    renderer: 'wgpu',
    supportedModes: ['adjacent'],
    paramFields: [
      {
        kind: 'select',
        key: 'direction',
        labelKey: 'fastcat.timeline.transition.paramDirection',
        options: [
          { value: 'clockwise', labelKey: 'fastcat.timeline.transition.directionClockwise' },
          {
            value: 'counterclockwise',
            labelKey: 'fastcat.timeline.transition.directionCounterclockwise',
          },
          { value: 'symmetric', labelKey: 'fastcat.timeline.transition.directionSymmetric' },
        ],
      },
    ],
    toTauriSpec: (params: Record<string, unknown>) => ({
      type: 'custom-wgsl',
      source: CLOCK_WGSL,
      params: {
        p0: params.direction === 'counterclockwise' ? -1 : params.direction === 'symmetric' ? 2 : 1,
      },
    }),
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
  {
    type: 'motion-blur',
    name: 'Motion Blur',
    nameKey: 'fastcat.transitions.motion-blur.name',
    icon: 'i-heroicons-forward',
    defaultDurationUs: 500_000,
    defaultParams: normalizeMotionBlurParams(),
    normalizeParams: normalizeMotionBlurParams,
    renderMode: 'shader',
    renderer: 'wgpu',
    supportedModes: ['adjacent'],
    paramFields: [
      {
        kind: 'number',
        key: 'angle',
        labelKey: 'fastcat.timeline.transition.paramAngle',
        min: -180,
        max: 180,
        step: 1,
      },
      {
        kind: 'number',
        key: 'motionBlur',
        labelKey: 'fastcat.timeline.transition.paramMotionBlur',
        min: 0,
        max: 100,
        step: 1,
      },
      blurQualityField,
      {
        kind: 'button-group',
        key: 'motionBlurMode',
        labelKey: 'fastcat.timeline.transition.paramMotionBlurMode',
        options: [
          { value: 'normal', labelKey: 'fastcat.timeline.transition.motionBlurModeNormal' },
          { value: 'bloom', labelKey: 'fastcat.timeline.transition.motionBlurModeBloom' },
        ],
      },
      {
        kind: 'number',
        key: 'brightness',
        labelKey: 'fastcat.timeline.transition.paramBrightness',
        min: -10,
        max: 10,
        step: 0.1,
      },
      {
        kind: 'number',
        key: 'bloomThreshold',
        labelKey: 'fastcat.timeline.transition.paramBloomThreshold',
        min: 0,
        max: 1,
        step: 0.01,
      },
    ],
    toTauriSpec: (
      params: Record<string, unknown>,
      durationSec?: number,
      options?: { isExport?: boolean; isPlaying?: boolean; previewBlurQuality?: string },
    ) => {
      const normalized = normalizeMotionBlurParams(params);
      const angle = finiteNumber(normalized.angle, 0);
      const rad = (angle * Math.PI) / 180;
      const quality = resolveBlurQuality(options, normalized.blurQuality);
      const samples = qualitySamples(quality, 8, 16, 32, 64);
      return {
        type: 'custom-wgsl',
        source: MOTION_BLUR_WGSL,
        params: {
          p0: Math.cos(rad),
          p1: Math.sin(rad),
          p2: motionBlurConst(finiteNumber(normalized.motionBlur, 50), durationSec, 0.005),
          p3: samples,
          p4: normalized.motionBlurMode === 'bloom' ? 1 : 0,
          p5: finiteNumber(normalized.brightness, 0),
          p6: finiteNumber(normalized.bloomThreshold, 0.7),
        },
      };
    },
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
  {
    type: 'barn-door',
    name: 'Barn Door',
    nameKey: 'fastcat.transitions.barn-door.name',
    icon: 'i-heroicons-arrows-right-left',
    defaultDurationUs: 500_000,
    defaultParams: {
      mode: 'open',
      edgeMode: 'gap',
      gap: 0.02,
      gapColor: '#000000',
      blur: 2,
      blurMode: 'scaled',
      angle: 0,
    },
    renderMode: 'shader',
    renderer: 'wgpu',
    supportedModes: ['adjacent'],
    paramFields: [
      {
        kind: 'button-group',
        key: 'mode',
        labelKey: 'fastcat.timeline.transition.paramBarnDoorMode',
        options: [
          { value: 'open', labelKey: 'fastcat.timeline.transition.barnDoorModeOpen' },
          { value: 'close', labelKey: 'fastcat.timeline.transition.barnDoorModeClose' },
        ],
      },
      {
        kind: 'button-group',
        key: 'edgeMode',
        labelKey: 'fastcat.timeline.transition.paramWipeEdgeMode',
        options: [
          { value: 'gap', labelKey: 'fastcat.timeline.transition.wipeEdgeModeGap' },
          { value: 'blur', labelKey: 'fastcat.timeline.transition.wipeEdgeModeBlur' },
        ],
      },
      {
        kind: 'button-group',
        key: 'blurMode',
        labelKey: 'fastcat.timeline.transition.paramBlurMode',
        options: [
          { value: 'scaled', labelKey: 'fastcat.timeline.transition.blurModeScaled' },
          { value: 'fixed', labelKey: 'fastcat.timeline.transition.blurModeFixed' },
        ],
      },
      {
        kind: 'number',
        key: 'gap',
        labelKey: 'fastcat.timeline.transition.paramGapSize',
        min: 0,
        max: 0.2,
        step: 0.005,
      },
      { kind: 'color', key: 'gapColor', labelKey: 'fastcat.timeline.transition.paramGapColor' },
      {
        kind: 'number',
        key: 'blur',
        labelKey: 'fastcat.timeline.transition.paramWipeEdgeBlur',
        min: 0,
        max: 20,
        step: 0.5,
      },
      {
        kind: 'number',
        key: 'angle',
        labelKey: 'fastcat.timeline.transition.paramAngle',
        min: -180,
        max: 180,
        step: 1,
      },
    ],
    toTauriSpec: (params: Record<string, unknown>) => {
      const useGap = params.edgeMode !== 'blur';
      const angle = (clamp(finiteNumber(params.angle, 0), -180, 180) * Math.PI) / 180;
      const [r, g, b] = hexToRgb01(params.gapColor, '#000000');
      return {
        type: 'custom-wgsl',
        source: BARN_DOOR_WGSL,
        params: {
          p0: Math.cos(angle),
          p1: Math.sin(angle),
          p2: useGap ? clamp(finiteNumber(params.gap, 0.02), 0, 0.2) : 0,
          p3: clamp(finiteNumber(params.blur, 2) / 100, 0.0001, 0.2),
          p4: useGap ? 1 : 0,
          p5: r,
          p6: g,
          p7: b,
          p8: params.mode === 'close' ? 0 : 1,
          p9: params.blurMode === 'fixed' ? 0 : 1,
        },
      };
    },
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
  {
    type: 'fade-to-black',
    name: 'Fade to Black',
    nameKey: 'fastcat.transitions.fade-to-black.name',
    icon: 'i-heroicons-moon',
    defaultDurationUs: 700_000,
    defaultParams: { color: '#000000' },
    renderMode: 'shader',
    renderer: 'wgpu',
    supportedModes: ['adjacent'],
    paramFields: [
      { kind: 'color', key: 'color', labelKey: 'fastcat.timeline.transition.paramFadeColor' },
    ],
    toTauriSpec: (params: Record<string, unknown>) => ({
      type: 'fade-through-color',
      color: normalizeTransitionColor(params.color, '#000000'),
    }),
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
  {
    type: 'circle',
    name: 'Circle',
    nameKey: 'fastcat.transitions.circle.name',
    icon: 'i-heroicons-stop-circle',
    defaultDurationUs: 600_000,
    defaultParams: normalizeCircleParams(),
    normalizeParams: normalizeCircleParams,
    renderMode: 'shader',
    renderer: 'wgpu',
    supportedModes: ['adjacent'],
    paramFields: [
      {
        kind: 'number',
        key: 'blur',
        labelKey: 'fastcat.timeline.transition.paramCircleBlur',
        min: 0,
        max: 20,
        step: 0.5,
      },
      blurModeField,
      fromToCenterField,
      anchorField,
      ...offsetFields,
      {
        kind: 'number',
        key: 'scaleX',
        labelKey: 'fastcat.timeline.transition.paramScaleX',
        min: 1,
        max: 1000,
        step: 1,
      },
      {
        kind: 'number',
        key: 'scaleY',
        labelKey: 'fastcat.timeline.transition.paramScaleY',
        min: 1,
        max: 1000,
        step: 1,
      },
      {
        kind: 'boolean',
        key: 'followScale',
        labelKey: 'fastcat.timeline.transition.paramFollowScale',
      },
    ],
    toTauriSpec: (params: Record<string, unknown>) => {
      const center = centerFromAnchor(params);
      return {
        type: 'custom-wgsl',
        source: ELLIPSE_WGSL,
        params: {
          p0: clamp(finiteNumber(params.blur, 1.5) / 100, 0.0001, 0.2),
          p1: params.blurMode === 'scaled' ? 1 : 0,
          p2: params.direction === 'to-center' ? -1 : 1,
          p3: center[0],
          p4: center[1],
          p5: clamp(finiteNumber(params.scaleX, 100), 1, 1000) / 100,
          p6: clamp(finiteNumber(params.scaleY, 100), 1, 1000) / 100,
          p7: params.followScale === true ? 1 : 0,
        },
      };
    },
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
  {
    type: 'rectangle',
    name: 'Rectangle',
    nameKey: 'fastcat.transitions.rectangle.name',
    icon: 'i-heroicons-stop',
    defaultDurationUs: 600_000,
    defaultParams: normalizeRectangleParams(),
    normalizeParams: normalizeRectangleParams,
    renderMode: 'shader',
    renderer: 'wgpu',
    supportedModes: ['adjacent'],
    paramFields: [
      {
        kind: 'number',
        key: 'blur',
        labelKey: 'fastcat.timeline.transition.paramRectangleBlur',
        min: 0,
        max: 20,
        step: 0.5,
      },
      blurModeField,
      {
        kind: 'button-group',
        key: 'direction',
        labelKey: 'fastcat.timeline.transition.paramDirection',
        options: [
          { value: 'from-center', labelKey: 'fastcat.timeline.transition.directionFromCenter' },
          { value: 'to-center', labelKey: 'fastcat.timeline.transition.directionToCenter' },
        ],
      },
      anchorField,
      ...offsetFields,
      {
        kind: 'button-group',
        key: 'contentMode',
        labelKey: 'fastcat.timeline.transition.paramContentMode',
        options: [
          { value: 'reveal', labelKey: 'fastcat.timeline.transition.contentModeReveal' },
          { value: 'zoom', labelKey: 'fastcat.timeline.transition.contentModeZoom' },
        ],
      },
    ],
    toTauriSpec: (params: Record<string, unknown>) => {
      const center = centerFromAnchor(params);
      return {
        type: 'custom-wgsl',
        source: RECTANGLE_WGSL,
        params: {
          p0: clamp(finiteNumber(params.blur, 1.5) / 100, 0.0001, 0.2),
          p1: params.blurMode === 'scaled' ? 1 : 0,
          p2: params.direction === 'to-center' ? -1 : 1,
          p3: params.contentMode === 'zoom' ? 1 : 0,
          p4: center[0],
          p5: center[1],
        },
      };
    },
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
  {
    type: 'blinds',
    name: 'Blinds',
    nameKey: 'fastcat.transitions.blinds.name',
    icon: 'i-heroicons-bars-3',
    defaultDurationUs: 1_000_000,
    defaultParams: {
      angle: 0,
      stripCount: 10,
      blur: 0,
      blurQuality: 'medium',
      motionBlur: 0,
      motionBlurMode: 'normal',
      brightnessMode: 'normal',
      brightness: 0,
      bloomThreshold: 0.7,
    },
    renderMode: 'shader',
    renderer: 'wgpu',
    supportedModes: ['adjacent'],
    paramFields: [
      {
        kind: 'number',
        key: 'angle',
        labelKey: 'fastcat.timeline.transition.paramAngle',
        min: -360,
        max: 360,
        step: 1,
      },
      {
        kind: 'number',
        key: 'stripCount',
        labelKey: 'fastcat.timeline.transition.paramStripCount',
        min: 2,
        max: 100,
        step: 1,
      },
      {
        kind: 'number',
        key: 'blur',
        labelKey: 'fastcat.timeline.transition.paramPostBlur',
        min: 0,
        max: 100,
        step: 1,
      },
      {
        kind: 'number',
        key: 'motionBlur',
        labelKey: 'fastcat.timeline.transition.paramMotionBlur',
        min: 0,
        max: 100,
        step: 1,
      },
      {
        kind: 'button-group',
        key: 'motionBlurMode',
        labelKey: 'fastcat.timeline.transition.paramMotionBlurMode',
        options: [
          { value: 'normal', labelKey: 'fastcat.timeline.transition.motionBlurModeNormal' },
          { value: 'bloom', labelKey: 'fastcat.timeline.transition.motionBlurModeBloom' },
        ],
      },
      {
        kind: 'button-group',
        key: 'brightnessMode',
        labelKey: 'fastcat.timeline.transition.paramBrightnessMode',
        options: [
          { value: 'normal', labelKey: 'fastcat.timeline.transition.brightnessModeNormal' },
          { value: 'bloom', labelKey: 'fastcat.timeline.transition.brightnessModeBloom' },
        ],
      },
      {
        kind: 'number',
        key: 'brightness',
        labelKey: 'fastcat.timeline.transition.paramBrightness',
        min: -10,
        max: 10,
        step: 0.1,
      },
      {
        kind: 'number',
        key: 'bloomThreshold',
        labelKey: 'fastcat.timeline.transition.paramBloomThreshold',
        min: 0,
        max: 1,
        step: 0.01,
      },
    ],
    toTauriSpec: (
      params: Record<string, unknown>,
      durationSec?: number,
      options?: { isExport?: boolean; isPlaying?: boolean; previewBlurQuality?: string },
    ) => {
      const rad = (clamp(finiteNumber(params.angle, 0), -360, 360) * Math.PI) / 180;
      const q = resolveBlurQuality(options, params.blurQuality);
      const samples = qualitySamples(q, 8, 16, 32, 64);
      return {
        type: 'custom-wgsl',
        source: BLINDS_WGSL,
        params: {
          p0: Math.cos(rad),
          p1: Math.sin(rad),
          p2: -Math.sin(rad),
          p3: Math.cos(rad),
          p4: Math.round(clamp(finiteNumber(params.stripCount, 10), 2, 100)),
          p5: clamp(finiteNumber(params.blur, 0), 0, 100),
          p6: samples,
          p7: motionBlurConst(clamp(finiteNumber(params.motionBlur, 0), 0, 100), durationSec),
          p8: params.motionBlurMode === 'bloom' ? 1 : 0,
          p9: params.brightnessMode === 'bloom' ? 1 : 0,
          p10: clamp(finiteNumber(params.brightness, 0), -10, 10),
          p11: clamp(finiteNumber(params.bloomThreshold, 0.7), 0, 1),
        },
      };
    },
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
  {
    type: 'zoom',
    name: 'Zoom',
    nameKey: 'fastcat.transitions.zoom.name',
    icon: 'i-heroicons-magnifying-glass',
    defaultDurationUs: 500_000,
    defaultParams: {
      scale: 3.0,
      fromRotation: 0,
      toRotation: 0,
      blur: 20,
      blurQuality: 'medium',
      brightnessMode: 'normal',
      brightness: 0,
    },
    renderMode: 'shader',
    renderer: 'wgpu',
    supportedModes: ['adjacent'],
    paramFields: [
      {
        kind: 'number',
        key: 'scale',
        labelKey: 'fastcat.timeline.transition.paramScale',
        min: 1.1,
        max: 10.0,
        step: 0.1,
      },
      {
        kind: 'number',
        key: 'blur',
        labelKey: 'fastcat.timeline.transition.paramBlur',
        min: 0,
        max: 100,
        step: 1,
      },
      {
        kind: 'button-group',
        key: 'brightnessMode',
        labelKey: 'fastcat.timeline.transition.paramBrightnessMode',
        options: [
          { value: 'normal', labelKey: 'fastcat.timeline.transition.brightnessModeNormal' },
          { value: 'bloom', labelKey: 'fastcat.timeline.transition.brightnessModeBloom' },
        ],
      },
      {
        kind: 'slider',
        key: 'brightness',
        labelKey: 'fastcat.timeline.transition.paramBrightness',
        min: 0,
        max: 5,
        step: 0.1,
      },
      {
        kind: 'number',
        key: 'fromRotation',
        labelKey: 'fastcat.timeline.transition.paramFromRotation',
        min: -360,
        max: 360,
        step: 1,
      },
      {
        kind: 'number',
        key: 'toRotation',
        labelKey: 'fastcat.timeline.transition.paramToRotation',
        min: -360,
        max: 360,
        step: 1,
      },
    ],
    toTauriSpec: (
      params: Record<string, unknown>,
      durationSec?: number,
      options?: { isExport?: boolean; isPlaying?: boolean; previewBlurQuality?: string },
    ) => {
      const q = resolveBlurQuality(options, params.blurQuality);
      const samples = qualitySamples(q, 8, 16, 32, 64);
      return {
        type: 'custom-wgsl',
        source: ZOOM_WGSL,
        params: {
          p0: clamp(finiteNumber(params.scale, 3.0), 1.1, 10.0),
          p1: (clamp(finiteNumber(params.fromRotation, 0), -360, 360) * Math.PI) / 180,
          p2: (clamp(finiteNumber(params.toRotation, 0), -360, 360) * Math.PI) / 180,
          p3: clamp(finiteNumber(params.blur, 20), 0, 100),
          p4: samples,
          p5: params.brightnessMode === 'bloom' ? 1.0 : 0.0,
          p6: clamp(finiteNumber(params.brightness, 0), 0, 5),
        },
      };
    },
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
  {
    type: 'bloom',
    name: 'Bloom',
    nameKey: 'fastcat.transitions.bloom.name',
    icon: 'i-heroicons-sparkles',
    defaultDurationUs: 500_000,
    defaultParams: { brightness: 1.5, blurLevel: 1.0, mode: 'bloom' },
    renderMode: 'shader',
    renderer: 'wgpu',
    supportedModes: ['adjacent'],
    paramFields: [
      {
        kind: 'button-group',
        key: 'mode',
        labelKey: 'fastcat.timeline.transition.paramMode',
        options: [
          { value: 'bloom', labelKey: 'fastcat.timeline.transition.modeBloom' },
          { value: 'normal', labelKey: 'fastcat.timeline.transition.modeNormal' },
        ],
      },
      {
        kind: 'slider',
        key: 'brightness',
        labelKey: 'fastcat.timeline.transition.paramBrightness',
        min: 0.1,
        max: 5.0,
        step: 0.1,
      },
      {
        kind: 'slider',
        key: 'blurLevel',
        labelKey: 'fastcat.timeline.transition.paramBlur',
        min: 0.0,
        max: 3.0,
        step: 0.1,
      },
    ],
    toTauriSpec: (
      params: Record<string, unknown>,
      _durationSec?: number,
      options?: { isExport?: boolean; isPlaying?: boolean; previewBlurQuality?: string },
    ) => {
      const quality = resolveBlurQuality(options, 'medium');
      return {
        type: 'custom-wgsl',
        source: BLOOM_WGSL,
        params: {
          p0: clamp(finiteNumber(params.brightness, 1.5), 0.1, 5.0),
          p1: clamp(finiteNumber(params.blurLevel, 1.0), 0.0, 3.0),
          p2: params.mode === 'normal' ? 0.0 : 1.0,
          p3: qualitySamples(quality, 5, 9, 17, 25),
        },
      };
    },
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
  {
    type: 'cube',
    name: 'Cube',
    nameKey: 'fastcat.transitions.cube.name',
    icon: 'i-heroicons-cube',
    defaultDurationUs: 500_000,
    defaultParams: {
      direction: 'left',
      zoomMode: 'unzoom',
      perspective: 0.7,
      gapSize: 0,
    },
    renderMode: 'shader',
    renderer: 'wgpu',
    supportedModes: ['adjacent'],
    paramFields: [
      {
        kind: 'select',
        key: 'direction',
        labelKey: 'fastcat.timeline.transition.paramDirection',
        options: [
          { value: 'left', labelKey: 'fastcat.timeline.transition.directionLeft' },
          { value: 'right', labelKey: 'fastcat.timeline.transition.directionRight' },
          { value: 'up', labelKey: 'fastcat.timeline.transition.directionUp' },
          { value: 'down', labelKey: 'fastcat.timeline.transition.directionDown' },
        ],
      },
      {
        kind: 'button-group',
        key: 'zoomMode',
        labelKey: 'fastcat.timeline.transition.paramMode',
        options: [
          { value: 'unzoom', labelKey: 'fastcat.timeline.transition.modeUnzoom' },
          { value: 'fixed', labelKey: 'fastcat.timeline.transition.modeFixed' },
        ],
      },
      {
        kind: 'number',
        key: 'perspective',
        labelKey: 'fastcat.timeline.transition.paramPerspective',
        min: 0.1,
        max: 3.0,
        step: 0.1,
      },
      {
        kind: 'number',
        key: 'gapSize',
        labelKey: 'fastcat.timeline.transition.paramGapSize',
        min: 0,
        max: 0.5,
        step: 0.01,
      },
    ],
    toTauriSpec: (params: Record<string, unknown>) => {
      const idx = directionIndex(params.direction); // 0 left, 1 right, 2 up, 3 down
      const dx = idx === 0 ? -1 : idx === 1 ? 1 : 0;
      const dy = idx === 2 ? -1 : idx === 3 ? 1 : 0;
      return {
        type: 'custom-wgsl',
        source: CUBE_WGSL,
        params: {
          p0: dx,
          p1: dy,
          p2: params.zoomMode === 'fixed' ? 0 : 1,
          p3: clamp(finiteNumber(params.perspective, 0.7), 0.1, 3.0),
          p4: clamp(finiteNumber(params.gapSize, 0), 0, 0.5),
        },
      };
    },
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
  {
    type: 'card-swap',
    name: 'Card Swap',
    nameKey: 'fastcat.transitions.card-swap.name',
    icon: 'i-heroicons-arrow-path-rounded-square',
    defaultDurationUs: 500_000,
    defaultParams: {
      direction: 'horizontal',
      mode: 'zoom',
      slideOrder: 'normal',
      maxDarkness: 0.5,
      shadowSize: 0.2,
      shadowOpacity: 0.6,
      blurStrength: 0.5,
      blurQuality: 'medium',
      bloom: 0,
    },
    renderMode: 'shader',
    renderer: 'wgpu',
    supportedModes: ['adjacent'],
    paramFields: [
      {
        kind: 'select',
        key: 'mode',
        labelKey: 'fastcat.timeline.transition.paramCardSwapMode',
        options: [
          { value: 'zoom', labelKey: 'fastcat.timeline.transition.modeZoom' },
          { value: 'slide', labelKey: 'fastcat.timeline.transition.modeSlide' },
        ],
      },
      {
        kind: 'select',
        key: 'direction',
        labelKey: 'fastcat.timeline.transition.paramDirection',
        options: [
          { value: 'horizontal', labelKey: 'fastcat.timeline.transition.directionHorizontal' },
          { value: 'vertical', labelKey: 'fastcat.timeline.transition.directionVertical' },
        ],
      },
      {
        kind: 'select',
        key: 'slideOrder',
        labelKey: 'fastcat.timeline.transition.paramSlideOrder',
        options: [
          { value: 'normal', labelKey: 'fastcat.timeline.transition.slideOrderNormal' },
          { value: 'reverse', labelKey: 'fastcat.timeline.transition.slideOrderReverse' },
        ],
      },
      {
        kind: 'slider',
        key: 'maxDarkness',
        labelKey: 'fastcat.timeline.transition.paramMaxDarkness',
        min: 0,
        max: 1,
        step: 0.05,
      },
      {
        kind: 'slider',
        key: 'shadowSize',
        labelKey: 'fastcat.timeline.transition.paramShadowSize',
        min: 0,
        max: 1,
        step: 0.05,
      },
      {
        kind: 'slider',
        key: 'shadowOpacity',
        labelKey: 'fastcat.timeline.transition.paramShadowOpacity',
        min: 0,
        max: 1,
        step: 0.05,
      },
      {
        kind: 'slider',
        key: 'blurStrength',
        labelKey: 'fastcat.timeline.transition.paramBlurStrength',
        min: 0,
        max: 1,
        step: 0.05,
      },
      {
        kind: 'slider',
        key: 'bloom',
        labelKey: 'fastcat.timeline.transition.paramBloom',
        min: 0,
        max: 1,
        step: 0.05,
      },
    ],
    toTauriSpec: (
      params: Record<string, unknown>,
      durationSec?: number,
      options?: { isExport?: boolean; isPlaying?: boolean; previewBlurQuality?: string },
    ) => {
      const q = resolveBlurQuality(options, params.blurQuality);
      const samples = qualitySamples(q, 4, 8, 16, 32);
      return {
        type: 'custom-wgsl',
        source: CARD_SWAP_WGSL,
        params: {
          p0: params.direction === 'vertical' ? 0 : 1,
          p1: params.mode === 'slide' ? 1 : 0,
          p2: params.slideOrder === 'reverse' ? 1 : 0,
          p3: clamp(finiteNumber(params.maxDarkness, 0.5), 0, 1),
          p4: clamp(finiteNumber(params.shadowSize, 0.2), 0, 1),
          p5: clamp(finiteNumber(params.shadowOpacity, 0.6), 0, 1),
          p6: clamp(finiteNumber(params.blurStrength, 0.5), 0, 1),
          p7: samples,
          p8: clamp(finiteNumber(params.bloom, 0), 0, 1),
        },
      };
    },
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
  {
    type: 'falling-card',
    name: 'Falling Card',
    nameKey: 'fastcat.transitions.falling-card.name',
    icon: 'i-heroicons-square-3-stack-3d',
    defaultDurationUs: 500_000,
    defaultParams: {
      direction: 'down',
      depthDirection: 'backward',
      action: 'fall',
    },
    renderMode: 'shader',
    renderer: 'wgpu',
    supportedModes: ['adjacent'],
    paramFields: [
      {
        kind: 'select',
        key: 'action',
        labelKey: 'fastcat.timeline.transition.paramAction',
        options: [
          { value: 'fall', labelKey: 'fastcat.timeline.transition.actionFall' },
          { value: 'rise', labelKey: 'fastcat.timeline.transition.actionRise' },
        ],
      },
      {
        kind: 'select',
        key: 'direction',
        labelKey: 'fastcat.timeline.transition.paramDirection',
        options: [
          { value: 'down', labelKey: 'fastcat.timeline.transition.directionDown' },
          { value: 'up', labelKey: 'fastcat.timeline.transition.directionUp' },
          { value: 'left', labelKey: 'fastcat.timeline.transition.directionLeft' },
          { value: 'right', labelKey: 'fastcat.timeline.transition.directionRight' },
        ],
      },
      {
        kind: 'select',
        key: 'depthDirection',
        labelKey: 'fastcat.timeline.transition.paramDepthDirection',
        options: [
          { value: 'backward', labelKey: 'fastcat.timeline.transition.depthDirectionBackward' },
          { value: 'forward', labelKey: 'fastcat.timeline.transition.depthDirectionForward' },
        ],
      },
    ],
    toTauriSpec: (params: Record<string, unknown>) => {
      // down=1, up=0, left=2, right=3 (matches web updateFilter)
      const d = params.direction;
      const dir = d === 'up' ? 0 : d === 'left' ? 2 : d === 'right' ? 3 : 1;
      return {
        type: 'custom-wgsl',
        source: FALLING_CARD_WGSL,
        params: {
          p0: dir,
          p1: params.depthDirection === 'forward' ? -1 : 1,
          p2: params.action === 'rise' ? 1 : 0,
        },
      };
    },
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
];

const tauriTransitionManifestByType = new Map(
  tauriTransitionManifests.map((manifest) => [manifest.type, manifest]),
);

export function getTauriTransitionManifest(type: string): TransitionManifest | undefined {
  return tauriTransitionManifestByType.get(type);
}
