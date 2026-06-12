import {
  applyTransitionCurve,
  type TransitionManifest,
  type TauriTransitionSpec,
} from '../core/registry';

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

const ZOOM_WGSL = `@group(0) @binding(0) var from_tex: texture_2d<f32>;
@group(0) @binding(1) var to_tex: texture_2d<f32>;
@group(0) @binding(2) var output_tex: texture_storage_2d<rgba8unorm, write>;

struct TransitionUniform {
    progress: f32,
    width: u32,
    height: u32,
    pad: u32,
    p0: f32, // scale
    p1: f32, // fromRotation
    p2: f32, // toRotation
    p3: f32, // blur strength
    p4: f32, // blur samples
    p5: f32, // brightness mode (0.0=normal, 1.0=bloom)
    p6: f32, // brightness amount
    p7: f32,
};
@group(0) @binding(3) var<uniform> uni: TransitionUniform;

fn rotate(pt: vec2<f32>, angle: f32, aspect: f32) -> vec2<f32> {
    let c = cos(angle);
    let s = sin(angle);
    var rotated = vec2<f32>(pt.x * aspect, pt.y);
    rotated = vec2<f32>(rotated.x * c - rotated.y * s, rotated.x * s + rotated.y * c);
    return vec2<f32>(rotated.x / aspect, rotated.y);
}

fn sample_blur(tex: texture_2d<f32>, uv: vec2<f32>, dir: vec2<f32>, blur_amount: f32) -> vec4<f32> {
    if (blur_amount < 0.001) {
        let coord = vec2<i32>(i32(uv.x * f32(uni.width)), i32(uv.y * f32(uni.height)));
        return textureLoad(tex, coord, 0);
    }
    var sum = vec4<f32>(0.0);
    let samples = i32(clamp(uni.p4, 4.0, 32.0));
    for (var i = 0; i < samples; i = i + 1) {
        let t = f32(i) / f32(samples);
        let offset = dir * (t * blur_amount);
        let offset_uv = uv + offset;
        let coord = vec2<i32>(
            i32(clamp(offset_uv.x, 0.0, 1.0) * f32(uni.width)), 
            i32(clamp(offset_uv.y, 0.0, 1.0) * f32(uni.height))
        );
        sum = sum + textureLoad(tex, coord, 0);
    }
    return sum / f32(samples);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= uni.width || gid.y >= uni.height) {
        return;
    }
    let coord = vec2<i32>(i32(gid.x), i32(gid.y));
    let uv = vec2<f32>(f32(gid.x) / f32(uni.width), f32(gid.y) / f32(uni.height));
    let aspect = f32(uni.width) / f32(uni.height);
    let center = vec2<f32>(0.5, 0.5);
    
    let from_scale = mix(1.0, uni.p0, uni.progress);
    let from_angle = mix(0.0, uni.p1 * 0.0174532925, uni.progress);
    let from_blur = mix(0.0, uni.p3 * 0.005, uni.progress);
    
    var from_pt = uv - center;
    from_pt = rotate(from_pt, from_angle, aspect);
    let from_uv = from_pt / from_scale + center;
    
    var from_color = vec4<f32>(0.0);
    if (from_uv.x >= 0.0 && from_uv.x <= 1.0 && from_uv.y >= 0.0 && from_uv.y <= 1.0) {
        from_color = sample_blur(from_tex, from_uv, center - from_uv, from_blur);
    }
    
    let to_scale = mix(uni.p0, 1.0, uni.progress);
    let to_angle = mix(uni.p2 * 0.0174532925, 0.0, uni.progress);
    let to_blur = mix(uni.p3 * 0.005, 0.0, uni.progress);
    
    var to_pt = uv - center;
    to_pt = rotate(to_pt, to_angle, aspect);
    let to_uv = to_pt / to_scale + center;
    
    var to_color = vec4<f32>(0.0);
    if (to_uv.x >= 0.0 && to_uv.x <= 1.0 && to_uv.y >= 0.0 && to_uv.y <= 1.0) {
        to_color = sample_blur(to_tex, to_uv, center - to_uv, to_blur);
    }
    
    let peak = 1.0 - abs(uni.progress - 0.5) * 2.0;
    let bright_factor = mix(1.0, 1.0 + uni.p6, peak);
    
    var final_color = mix(from_color, to_color, uni.progress) * bright_factor;
    final_color.a = 1.0;
    textureStore(output_tex, coord, final_color);
}`;

const BLOOM_WGSL = `@group(0) @binding(0) var from_tex: texture_2d<f32>;
@group(0) @binding(1) var to_tex: texture_2d<f32>;
@group(0) @binding(2) var output_tex: texture_storage_2d<rgba8unorm, write>;

struct TransitionUniform {
    progress: f32,
    width: u32,
    height: u32,
    pad: u32,
    p0: f32, // brightness
    p1: f32, // blurLevel
    p2: f32, // isBloom (1.0 = bloom, 0.0 = normal)
    p3: f32, p4: f32, p5: f32, p6: f32, p7: f32,
};
@group(0) @binding(3) var<uniform> uni: TransitionUniform;

fn luma(color: vec3<f32>) -> f32 {
    return dot(color, vec3<f32>(0.299, 0.587, 0.114));
}

fn extract_bright(color: vec4<f32>) -> vec4<f32> {
    let luminance = luma(color.rgb);
    let threshold = 0.5;
    let intensity = smoothstep(threshold, threshold + 0.2, luminance);
    return color * intensity;
}

fn sample_blur(tex: texture_2d<f32>, coord: vec2<i32>, blur_amount: f32, is_bloom: bool) -> vec4<f32> {
    if (blur_amount < 1.0) {
        return textureLoad(tex, coord, 0);
    }
    var sum = vec4<f32>(0.0);
    var weight_sum = 0.0;
    let r = i32(clamp(blur_amount, 1.0, 8.0));
    
    for (var y = -r; y <= r; y = y + 1) {
        for (var x = -r; x <= r; x = x + 1) {
            let sample_coord = vec2<i32>(
                clamp(coord.x + x, 0, i32(uni.width) - 1),
                clamp(coord.y + y, 0, i32(uni.height) - 1)
            );
            var color = textureLoad(tex, sample_coord, 0);
            if (is_bloom) {
                color = extract_bright(color);
            }
            let dist = f32(x * x + y * y);
            let w = exp(-dist / 8.0);
            sum = sum + color * w;
            weight_sum = weight_sum + w;
        }
    }
    return sum / max(weight_sum, 0.0001);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= uni.width || gid.y >= uni.height) {
        return;
    }
    let coord = vec2<i32>(i32(gid.x), i32(gid.y));
    let peak = 1.0 - abs(uni.progress - 0.5) * 2.0;
    let blur_amount = uni.p1 * peak * 4.0;
    let is_bloom = uni.p2 > 0.5;
    
    let from_color = textureLoad(from_tex, coord, 0);
    let to_color = textureLoad(to_tex, coord, 0);
    let base_color = mix(from_color, to_color, uni.progress);
    
    if (is_bloom) {
        let bloom_from = sample_blur(from_tex, coord, blur_amount, true);
        let bloom_to = sample_blur(to_tex, coord, blur_amount, true);
        let mixed_bloom = mix(bloom_from, bloom_to, uni.progress);
        
        let out_color = base_color + mixed_bloom * uni.p0 * peak;
        textureStore(output_tex, coord, vec4<f32>(min(out_color.rgb, vec3<f32>(1.0)), base_color.a));
    } else {
        let blur_from = sample_blur(from_tex, coord, blur_amount, false);
        let blur_to = sample_blur(to_tex, coord, blur_amount, false);
        let mixed_blur = mix(blur_from, blur_to, uni.progress);
        
        let brightness_mult = mix(1.0, uni.p0, peak);
        let out_color = mixed_blur * brightness_mult;
        textureStore(output_tex, coord, vec4<f32>(min(out_color.rgb, vec3<f32>(1.0)), base_color.a));
    }
}`;

const CLOCK_WGSL = `@group(0) @binding(0) var from_tex: texture_2d<f32>;
@group(0) @binding(1) var to_tex: texture_2d<f32>;
@group(0) @binding(2) var output_tex: texture_storage_2d<rgba8unorm, write>;

struct TransitionUniform {
    progress: f32,
    width: u32,
    height: u32,
    pad: u32,
    p0: f32, p1: f32, p2: f32, p3: f32,
    p4: f32, p5: f32, p6: f32, p7: f32,
};
@group(0) @binding(3) var<uniform> uni: TransitionUniform;

const PI = 3.1415926535897932384626433832795;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= uni.width || gid.y >= uni.height) {
        return;
    }
    let coord = vec2<i32>(i32(gid.x), i32(gid.y));
    let uv = vec2<f32>(f32(gid.x) / f32(uni.width), f32(gid.y) / f32(uni.height));
    let centered = uv - vec2<f32>(0.5, 0.5);
    var angle = atan2(centered.x, -centered.y);
    if (angle < 0.0) {
        angle = angle + PI * 2.0;
    }
    if (uni.p0 < 0.0) {
        angle = PI * 2.0 - angle;
        if (angle >= PI * 2.0) {
            angle = angle - PI * 2.0;
        }
    } else if (uni.p0 > 1.5) {
        if (angle > PI) {
            angle = PI * 2.0 - angle;
        }
        angle = angle * 2.0;
    }
    let reveal = 1.0 - smoothstep(uni.progress - 0.001, uni.progress + 0.001, angle / (PI * 2.0));
    textureStore(output_tex, coord, mix(textureLoad(from_tex, coord, 0), textureLoad(to_tex, coord, 0), reveal));
}`;

const RECTANGLE_WGSL = `@group(0) @binding(0) var from_tex: texture_2d<f32>;
@group(0) @binding(1) var to_tex: texture_2d<f32>;
@group(0) @binding(2) var output_tex: texture_storage_2d<rgba8unorm, write>;

struct TransitionUniform {
    progress: f32,
    width: u32,
    height: u32,
    pad: u32,
    p0: f32, // blur
    p1: f32, // direction
    p2: f32, // center x
    p3: f32, // center y
    p4: f32, p5: f32, p6: f32, p7: f32,
};
@group(0) @binding(3) var<uniform> uni: TransitionUniform;

fn rect_distance(p: vec2<f32>, center: vec2<f32>, size: vec2<f32>) -> f32 {
    let d = abs(p - center) - size;
    return length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= uni.width || gid.y >= uni.height) {
        return;
    }
    let coord = vec2<i32>(i32(gid.x), i32(gid.y));
    let uv = vec2<f32>(f32(gid.x) / f32(uni.width), f32(gid.y) / f32(uni.height));
    let aspect = f32(uni.width) / f32(uni.height);
    let center = vec2<f32>(uni.p2, uni.p3);
    let t = select(1.0 - uni.progress, uni.progress, uni.p1 > 0.0);
    let p = vec2<f32>((uv.x - center.x) * aspect, uv.y - center.y);
    let max_size = vec2<f32>(max(center.x, 1.0 - center.x) * aspect, max(center.y, 1.0 - center.y));
    let dist = rect_distance(p, vec2<f32>(0.0), max_size * t);
    var reveal = 1.0 - smoothstep(-max(uni.p0, 0.0001), max(uni.p0, 0.0001), dist);
    if (uni.p1 < 0.0) {
        reveal = 1.0 - reveal;
    }
    textureStore(output_tex, coord, mix(textureLoad(from_tex, coord, 0), textureLoad(to_tex, coord, 0), reveal));
}`;

const ELLIPSE_WGSL = `@group(0) @binding(0) var from_tex: texture_2d<f32>;
@group(0) @binding(1) var to_tex: texture_2d<f32>;
@group(0) @binding(2) var output_tex: texture_storage_2d<rgba8unorm, write>;

struct TransitionUniform {
    progress: f32,
    width: u32,
    height: u32,
    pad: u32,
    p0: f32, // blur
    p1: f32, // direction
    p2: f32, // center x
    p3: f32, // center y
    p4: f32, // scale x
    p5: f32, // scale y
    p6: f32, p7: f32,
};
@group(0) @binding(3) var<uniform> uni: TransitionUniform;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= uni.width || gid.y >= uni.height) {
        return;
    }
    let coord = vec2<i32>(i32(gid.x), i32(gid.y));
    let uv = vec2<f32>(f32(gid.x) / f32(uni.width), f32(gid.y) / f32(uni.height));
    let aspect = f32(uni.width) / f32(uni.height);
    let center = vec2<f32>(uni.p2, uni.p3);
    let scale = max(vec2<f32>(uni.p4, uni.p5), vec2<f32>(0.001));
    let t = select(1.0 - uni.progress, uni.progress, uni.p1 > 0.0);
    let p = vec2<f32>((uv.x - center.x) * aspect, uv.y - center.y) / scale;
    let corners = array<vec2<f32>, 4>(
        (vec2<f32>(0.0, 0.0) - center) * vec2<f32>(aspect, 1.0) / scale,
        (vec2<f32>(1.0, 0.0) - center) * vec2<f32>(aspect, 1.0) / scale,
        (vec2<f32>(0.0, 1.0) - center) * vec2<f32>(aspect, 1.0) / scale,
        (vec2<f32>(1.0, 1.0) - center) * vec2<f32>(aspect, 1.0) / scale
    );
    let max_radius = max(max(length(corners[0]), length(corners[1])), max(length(corners[2]), length(corners[3])));
    var reveal = 1.0 - smoothstep(max_radius * t - max(uni.p0, 0.0001), max_radius * t + max(uni.p0, 0.0001), length(p));
    if (uni.p1 < 0.0) {
        reveal = 1.0 - reveal;
    }
    textureStore(output_tex, coord, mix(textureLoad(from_tex, coord, 0), textureLoad(to_tex, coord, 0), reveal));
}`;

const BLINDS_WGSL = `@group(0) @binding(0) var from_tex: texture_2d<f32>;
@group(0) @binding(1) var to_tex: texture_2d<f32>;
@group(0) @binding(2) var output_tex: texture_storage_2d<rgba8unorm, write>;

struct TransitionUniform {
    progress: f32,
    width: u32,
    height: u32,
    pad: u32,
    p0: f32, // angle degrees
    p1: f32, // strip count
    p2: f32, p3: f32, p4: f32, p5: f32, p6: f32, p7: f32,
};
@group(0) @binding(3) var<uniform> uni: TransitionUniform;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= uni.width || gid.y >= uni.height) {
        return;
    }
    let coord = vec2<i32>(i32(gid.x), i32(gid.y));
    let uv = vec2<f32>(f32(gid.x) / f32(uni.width), f32(gid.y) / f32(uni.height));
    let angle = uni.p0 * 0.0174532925;
    let axis = vec2<f32>(cos(angle), sin(angle));
    let perp = vec2<f32>(-axis.y, axis.x);
    let strip_coord = dot(uv - vec2<f32>(0.5), perp) + 0.5;
    let strip_index = floor(strip_coord * max(uni.p1, 2.0));
    let phase = fract(strip_coord * max(uni.p1, 2.0));
    let stagger = (strip_index / max(uni.p1, 2.0)) * 0.18;
    let reveal = smoothstep(0.0, 1.0, uni.progress * 1.18 - stagger);
    let mask = step(phase, reveal);
    textureStore(output_tex, coord, mix(textureLoad(from_tex, coord, 0), textureLoad(to_tex, coord, 0), mask));
}`;

const BARN_DOOR_WGSL = `@group(0) @binding(0) var from_tex: texture_2d<f32>;
@group(0) @binding(1) var to_tex: texture_2d<f32>;
@group(0) @binding(2) var output_tex: texture_storage_2d<rgba8unorm, write>;

struct TransitionUniform {
    progress: f32,
    width: u32,
    height: u32,
    pad: u32,
    p0: f32, // angle degrees
    p1: f32, // open=1 close=-1
    p2: f32, // blur
    p3: f32, p4: f32, p5: f32, p6: f32, p7: f32,
};
@group(0) @binding(3) var<uniform> uni: TransitionUniform;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= uni.width || gid.y >= uni.height) {
        return;
    }
    let coord = vec2<i32>(i32(gid.x), i32(gid.y));
    let uv = vec2<f32>(f32(gid.x) / f32(uni.width), f32(gid.y) / f32(uni.height));
    let aspect = f32(uni.width) / f32(uni.height);
    let angle = uni.p0 * 0.0174532925;
    let axis = vec2<f32>(cos(angle), sin(angle));
    let p = (uv - vec2<f32>(0.5)) * vec2<f32>(aspect, 1.0);
    let max_dist = 0.5 * (aspect * abs(axis.x) + abs(axis.y));
    let dist = abs(dot(p, axis));
    let t = select(1.0 - uni.progress, uni.progress, uni.p1 > 0.0);
    var reveal = 1.0 - smoothstep(max_dist * t - max(uni.p2, 0.0001), max_dist * t + max(uni.p2, 0.0001), dist);
    if (uni.p1 < 0.0) {
        reveal = 1.0 - reveal;
    }
    textureStore(output_tex, coord, mix(textureLoad(from_tex, coord, 0), textureLoad(to_tex, coord, 0), reveal));
}`;

const DIRECTIONAL_ZOOM_WGSL = `@group(0) @binding(0) var from_tex: texture_2d<f32>;
@group(0) @binding(1) var to_tex: texture_2d<f32>;
@group(0) @binding(2) var output_tex: texture_storage_2d<rgba8unorm, write>;

struct TransitionUniform {
    progress: f32,
    width: u32,
    height: u32,
    pad: u32,
    p0: f32, // direction
    p1: f32, // scale peak
    p2: f32, // darkness
    p3: f32, p4: f32, p5: f32, p6: f32, p7: f32,
};
@group(0) @binding(3) var<uniform> uni: TransitionUniform;

fn sample_checked(tex: texture_2d<f32>, uv: vec2<f32>) -> vec4<f32> {
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        return vec4<f32>(0.0);
    }
    let coord = vec2<i32>(
        i32(clamp(uv.x * f32(uni.width), 0.0, f32(uni.width) - 1.0)),
        i32(clamp(uv.y * f32(uni.height), 0.0, f32(uni.height) - 1.0))
    );
    return textureLoad(tex, coord, 0);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= uni.width || gid.y >= uni.height) {
        return;
    }
    let coord = vec2<i32>(i32(gid.x), i32(gid.y));
    let uv = vec2<f32>(f32(gid.x) / f32(uni.width), f32(gid.y) / f32(uni.height));
    let dir = i32(round(uni.p0));
    var axis = vec2<f32>(1.0, 0.0);
    if (dir == 1) { axis = vec2<f32>(-1.0, 0.0); }
    if (dir == 2) { axis = vec2<f32>(0.0, 1.0); }
    if (dir == 3) { axis = vec2<f32>(0.0, -1.0); }
    let peak = 1.0 - abs(uni.progress - 0.5) * 2.0;
    let scale = mix(1.0, max(uni.p1, 1.0), peak);
    let from_uv = (uv - vec2<f32>(0.5)) / scale + vec2<f32>(0.5) + axis * uni.progress;
    let to_uv = (uv - vec2<f32>(0.5)) / scale + vec2<f32>(0.5) + axis * (uni.progress - 1.0);
    var color = mix(sample_checked(from_tex, from_uv), sample_checked(to_tex, to_uv), uni.progress);
    color.rgb = color.rgb * (1.0 - uni.p2 * peak);
    textureStore(output_tex, coord, color);
}`;

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
    toTauriSpec: () => ({ type: 'crossfade' }),
    computeOutOpacity: () => 1,
    computeInOpacity: () => 1,
  },
  {
    type: 'wipe',
    name: 'Wipe',
    nameKey: 'fastcat.transitions.wipe.name',
    icon: 'i-heroicons-arrow-long-right',
    defaultDurationUs: 700_000,
    defaultParams: {
      angle: 0,
      softness: 0.08,
    },
    renderMode: 'shader',
    renderer: 'wgpu',
    paramFields: [
      {
        kind: 'slider',
        key: 'angle',
        labelKey: 'fastcat.transitions.wipe.params.angle',
        min: -180,
        max: 180,
        step: 1,
      },
      {
        kind: 'slider',
        key: 'softness',
        labelKey: 'fastcat.transitions.wipe.params.softness',
        min: 0,
        max: 1,
        step: 0.01,
      },
    ],
    toTauriSpec: (params) => ({
      type: 'wipe',
      angle_deg: clamp(finiteNumber(params.angle, 0), -180, 180),
      softness: clamp(finiteNumber(params.softness, 0.08), 0, 1),
    }),
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
  {
    type: 'slide',
    name: 'Slide',
    nameKey: 'fastcat.transitions.slide.name',
    icon: 'i-heroicons-arrows-pointing-out',
    defaultDurationUs: 500_000,
    defaultParams: {
      direction: 'left',
    },
    renderMode: 'shader',
    renderer: 'wgpu',
    paramFields: [
      {
        kind: 'select',
        key: 'direction',
        labelKey: 'fastcat.transitions.slide.params.direction',
        options: [
          { labelKey: 'fastcat.transitions.slide.options.left', value: 'left' },
          { labelKey: 'fastcat.transitions.slide.options.right', value: 'right' },
          { labelKey: 'fastcat.transitions.slide.options.up', value: 'up' },
          { labelKey: 'fastcat.transitions.slide.options.down', value: 'down' },
        ],
      },
    ],
    toTauriSpec: (params): TauriTransitionSpec => {
      return { type: 'slide', direction: normalizeDirection(params.direction) };
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
    defaultParams: {
      direction: 'clockwise',
    },
    renderMode: 'shader',
    renderer: 'wgpu',
    toTauriSpec: (params: Record<string, unknown>) => ({
      type: 'custom-wgsl',
      source: CLOCK_WGSL,
      params: {
        p0:
          params.direction === 'counterclockwise' ? -1 : params.direction === 'symmetric' ? 2 : 1,
      },
    }),
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
      blur: 0.02,
      blurMode: 'scaled',
      angle: 0,
    },
    renderMode: 'shader',
    renderer: 'wgpu',
    toTauriSpec: (params: Record<string, unknown>) => ({
      type: 'custom-wgsl',
      source: BARN_DOOR_WGSL,
      params: {
        p0: clamp(finiteNumber(params.angle, 0), -180, 180),
        p1: params.mode === 'close' ? -1 : 1,
        p2: clamp(finiteNumber(params.blur, 0.02), 0.0001, 0.2),
      },
    }),
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
  {
    type: 'fade-to-black',
    name: 'Fade to Black',
    nameKey: 'fastcat.transitions.fade-to-black.name',
    icon: 'i-heroicons-moon',
    defaultDurationUs: 700_000,
    defaultParams: {
      color: '#000000',
    },
    renderMode: 'shader',
    renderer: 'wgpu',
    toTauriSpec: (params) => ({
      type: 'fade-through-color',
      color: normalizeTransitionColor(params.color, '#000000'),
    }),
    computeOutOpacity: (progress, _params, curve) => {
      const t = applyTransitionCurve(progress, curve);
      return t < 0.5 ? 1 - t * 2 : 0;
    },
    computeInOpacity: (progress, _params, curve) => {
      const t = applyTransitionCurve(progress, curve);
      return t < 0.5 ? 0 : (t - 0.5) * 2;
    },
  },
  {
    type: 'circle',
    name: 'Circle',
    nameKey: 'fastcat.transitions.circle.name',
    icon: 'i-heroicons-eye',
    defaultDurationUs: 600_000,
    defaultParams: {
      blur: 0.015,
      blurMode: 'fixed',
      direction: 'from-center',
      anchor: 'center',
      offsetX: 0,
      offsetY: 0,
      scaleX: 100,
      scaleY: 100,
      followScale: false,
    },
    renderMode: 'shader',
    renderer: 'wgpu',
    paramFields: [
      {
        kind: 'slider',
        key: 'blur',
        labelKey: 'fastcat.timeline.transition.paramCircleBlur',
        min: 0.0001,
        max: 0.2,
        step: 0.0025,
      },
      {
        kind: 'select',
        key: 'direction',
        labelKey: 'fastcat.timeline.transition.paramDirection',
        options: [
          {
            value: 'from-center',
            labelKey: 'fastcat.timeline.transition.directionFromCenter',
          },
          { value: 'to-center', labelKey: 'fastcat.timeline.transition.directionToCenter' },
        ],
      },
      {
        kind: 'select',
        key: 'anchor',
        labelKey: 'fastcat.timeline.transition.paramAnchor',
        options: [
          { value: 'center', labelKey: 'fastcat.timeline.transition.anchorCenter' },
          { value: 'top-left', labelKey: 'fastcat.timeline.transition.anchorTopLeft' },
          { value: 'top-right', labelKey: 'fastcat.timeline.transition.anchorTopRight' },
          { value: 'bottom-left', labelKey: 'fastcat.timeline.transition.anchorBottomLeft' },
          { value: 'bottom-right', labelKey: 'fastcat.timeline.transition.anchorBottomRight' },
        ],
      },
    ],
    toTauriSpec: (params: Record<string, unknown>) => {
      const center = centerFromAnchor(params);
      return {
        type: 'custom-wgsl',
        source: ELLIPSE_WGSL,
        params: {
          p0: clamp(finiteNumber(params.blur, 0.015), 0.0001, 0.2),
          p1: params.direction === 'to-center' ? -1 : 1,
          p2: center[0],
          p3: center[1],
          p4: clamp(finiteNumber(params.scaleX, 100), 1, 1000) / 100,
          p5: clamp(finiteNumber(params.scaleY, 100), 1, 1000) / 100,
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
    defaultParams: {
      blur: 0.015,
      blurMode: 'fixed',
      direction: 'from-center',
      anchor: 'center',
      offsetX: 0,
      offsetY: 0,
      contentMode: 'reveal',
    },
    renderMode: 'shader',
    renderer: 'wgpu',
    toTauriSpec: (params: Record<string, unknown>) => {
      const center = centerFromAnchor(params);
      return {
        type: 'custom-wgsl',
        source: RECTANGLE_WGSL,
        params: {
          p0: clamp(finiteNumber(params.blur, 0.015), 0.0001, 0.2),
          p1: params.direction === 'to-center' ? -1 : 1,
          p2: center[0],
          p3: center[1],
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
    toTauriSpec: (params: Record<string, unknown>) => ({
      type: 'custom-wgsl',
      source: BLINDS_WGSL,
      params: {
        p0: clamp(finiteNumber(params.angle, 0), -360, 360),
        p1: Math.round(clamp(finiteNumber(params.stripCount, 10), 2, 100)),
      },
    }),
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
    toTauriSpec: (params: Record<string, unknown>) => {
      let samples = 16.0;
      const blurQuality = params.blurQuality as string;
      if (blurQuality === 'low') samples = 8.0;
      else if (blurQuality === 'high') samples = 32.0;
      else if (blurQuality === 'ultra') samples = 64.0;

      return {
        type: 'custom-wgsl',
        source: ZOOM_WGSL,
        params: {
          p0: finiteNumber(params.scale as number, 3.0),
          p1: finiteNumber(params.fromRotation as number, 0.0),
          p2: finiteNumber(params.toRotation as number, 0.0),
          p3: finiteNumber(params.blur as number, 20.0),
          p4: samples,
          p5: params.brightnessMode === 'bloom' ? 1.0 : 0.0,
          p6: finiteNumber(params.brightness as number, 0.0),
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
    defaultParams: {
      brightness: 1.5,
      blurLevel: 1.0,
      mode: 'bloom',
    },
    renderMode: 'shader',
    renderer: 'wgpu',
    toTauriSpec: (params: Record<string, unknown>) => ({
      type: 'custom-wgsl',
      source: BLOOM_WGSL,
      params: {
        p0: finiteNumber(params.brightness as number, 1.5),
        p1: finiteNumber(params.blurLevel as number, 1.0),
        p2: params.mode === 'normal' ? 0.0 : 1.0,
      },
    }),
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
  {
    type: 'cube',
    name: 'Cube',
    nameKey: 'fastcat.transitions.cube.name',
    icon: 'i-heroicons-cube',
    defaultDurationUs: 700_000,
    defaultParams: {
      direction: 'left',
      unzoomAmount: 0.3,
      perspective: 0.7,
      gapSize: 0,
    },
    renderMode: 'shader',
    renderer: 'wgpu',
    toTauriSpec: (params: Record<string, unknown>) => ({
      type: 'custom-wgsl',
      source: DIRECTIONAL_ZOOM_WGSL,
      params: {
        p0: directionIndex(params.direction),
        p1: 1 + clamp(finiteNumber(params.unzoomAmount, 0.3), 0, 1),
        p2: 0.18,
      },
    }),
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
  {
    type: 'card-swap',
    name: 'Card Swap',
    nameKey: 'fastcat.transitions.card-swap.name',
    icon: 'i-heroicons-rectangle-stack',
    defaultDurationUs: 800_000,
    defaultParams: {
      direction: 'left',
      mode: 'overlap',
      slideOrder: 'out-first',
      maxDarkness: 0.5,
      shadowSize: 0.2,
      shadowOpacity: 0.6,
      blurStrength: 0.5,
      blurQuality: 'low',
      bloom: false,
    },
    renderMode: 'shader',
    renderer: 'wgpu',
    toTauriSpec: (params: Record<string, unknown>) => ({
      type: 'custom-wgsl',
      source: DIRECTIONAL_ZOOM_WGSL,
      params: {
        p0: directionIndex(params.direction),
        p1: 1.08,
        p2: clamp(finiteNumber(params.maxDarkness, 0.5), 0, 1),
      },
    }),
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
  {
    type: 'falling-card',
    name: 'Falling Card',
    nameKey: 'fastcat.transitions.falling-card.name',
    icon: 'i-heroicons-square-3-stack-3d',
    defaultDurationUs: 800_000,
    defaultParams: {
      direction: 'left',
      depthDirection: 'backward',
      action: 'out',
    },
    renderMode: 'shader',
    renderer: 'wgpu',
    toTauriSpec: (params: Record<string, unknown>) => ({
      type: 'custom-wgsl',
      source: DIRECTIONAL_ZOOM_WGSL,
      params: {
        p0: directionIndex(params.direction),
        p1: params.depthDirection === 'forward' ? 1.35 : 1.12,
        p2: 0.28,
      },
    }),
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
