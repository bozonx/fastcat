// =============================================================================
// Shared video-effect compute shader (cross-backend ABI).
//
// This is the SINGLE source of effect math for both backends:
//   - native: `EffectPipeline` in `src-tauri/src/compositor/effects/mod.rs`
//     (`include_str!` of this file);
//   - web: the WebGPU compute runner (imported via Vite `?raw`).
//
// ABI — do not break without updating BOTH backends and the plugin contract:
//   @group(0) @binding(0) input_tex      : texture_2d<f32>            (read)
//   @group(0) @binding(1) output_tex     : texture_storage_2d<rgba8unorm, write>
//   @group(0) @binding(2) effect         : EffectUniform (uniform, dynamic offset)
//   @group(0) @binding(3) secondary_tex  : texture_2d<f32>            (read)
//   entry point: `main`, @workgroup_size(8, 8, 1)
//
// EffectUniform layout (must match the Rust `EffectUniform` struct byte-for-byte):
//   mode: u32, width: u32, height: u32, seed: u32, p0..p7: f32
//
// Mode codes (set by the pass builder; see Rust `build_passes`/`effect_to_pass`):
//   0  custom WGSL (plugins; replaced by a custom pipeline, this is a no-op here)
//   1  brightness (p0)              2  contrast (p0)            3  saturation (p0)
//   4  gaussian blur horizontal (p0=radius)
//   5  sharpen (p0)                 6  pixelate (p0=size)
//   8  vignette (p0=strength, p1=radius, p2=softness)
//   9  noise (p0=amount, seed)      10 chromatic aberration (p0=amount, p1=angle_deg)
//   11 hue rotation (p0=degrees)    12 levels (p0..p4)
//   13 chroma key (p0..p2=key rgb, p3=threshold, p4=smoothness)
//   14 gaussian blur vertical (p0=radius)
//   15 bloom bright-pass extract (p0=threshold)
//   18 bloom compose (input=original, secondary=blurred mask, p1=strength)
// =============================================================================

struct EffectUniform {
    mode: u32,
    width: u32,
    height: u32,
    seed: u32,
    p0: f32,
    p1: f32,
    p2: f32,
    p3: f32,
    p4: f32,
    p5: f32,
    p6: f32,
    p7: f32,
};

@group(0) @binding(0) var input_tex: texture_2d<f32>;
@group(0) @binding(1) var output_tex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> effect: EffectUniform;
@group(0) @binding(3) var secondary_tex: texture_2d<f32>;

fn clamp_coord(coord: vec2<i32>) -> vec2<i32> {
    return vec2<i32>(
        clamp(coord.x, 0, i32(effect.width) - 1),
        clamp(coord.y, 0, i32(effect.height) - 1)
    );
}

fn load_px(coord: vec2<i32>) -> vec4<f32> {
    return textureLoad(input_tex, clamp_coord(coord), 0);
}

fn load_secondary(coord: vec2<i32>) -> vec4<f32> {
    return textureLoad(secondary_tex, clamp_coord(coord), 0);
}

fn luma(color: vec3<f32>) -> f32 {
    return dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn hash21(p: vec2<f32>) -> f32 {
    let q = fract(vec3<f32>(p.x, p.y, p.x) * vec3<f32>(0.1031, 0.1030, 0.0973));
    let r = q + dot(q, q.yzx + vec3<f32>(33.33));
    return fract((r.x + r.y) * r.z);
}

fn rotate_hue(color: vec3<f32>, degrees: f32) -> vec3<f32> {
    let angle = degrees * 0.017453292519943295;
    let s = sin(angle);
    let c = cos(angle);
    let k = vec3<f32>(0.57735026919);
    return color * c + cross(k, color) * s + k * dot(k, color) * (1.0 - c);
}

fn sample_blur_h(coord: vec2<i32>, radius: f32) -> vec4<f32> {
    let safe_radius = max(radius, 0.0);
    let r = i32(clamp(round(safe_radius), 0.0, 64.0));
    if (r == 0) {
        return load_px(coord);
    }
    let stride = max(safe_radius / f32(r), 1.0);
    var sum = vec4<f32>(0.0);
    var weight_sum = 0.0;
    let sigma = max(safe_radius * 0.5, 1.0);
    let double_sigma_sq = 2.0 * sigma * sigma;
    for (var x = -r; x <= r; x = x + 1) {
        let sample_dist = f32(x) * stride;
        let sample_offset = i32(round(sample_dist));
        let dist = sample_dist * sample_dist;
        let w = exp(-dist / double_sigma_sq);
        sum += load_px(coord + vec2<i32>(sample_offset, 0)) * w;
        weight_sum += w;
    }
    return sum / max(weight_sum, 0.0001);
}

fn sample_blur_v(coord: vec2<i32>, radius: f32) -> vec4<f32> {
    let safe_radius = max(radius, 0.0);
    let r = i32(clamp(round(safe_radius), 0.0, 64.0));
    if (r == 0) {
        return load_px(coord);
    }
    let stride = max(safe_radius / f32(r), 1.0);
    var sum = vec4<f32>(0.0);
    var weight_sum = 0.0;
    let sigma = max(safe_radius * 0.5, 1.0);
    let double_sigma_sq = 2.0 * sigma * sigma;
    for (var y = -r; y <= r; y = y + 1) {
        let sample_dist = f32(y) * stride;
        let sample_offset = i32(round(sample_dist));
        let dist = sample_dist * sample_dist;
        let w = exp(-dist / double_sigma_sq);
        sum += load_px(coord + vec2<i32>(0, sample_offset)) * w;
        weight_sum += w;
    }
    return sum / max(weight_sum, 0.0001);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= effect.width || gid.y >= effect.height) {
        return;
    }
    let coord = vec2<i32>(i32(gid.x), i32(gid.y));
    let uv = vec2<f32>(f32(gid.x) / max(f32(effect.width - 1u), 1.0), f32(gid.y) / max(f32(effect.height - 1u), 1.0));
    var color = load_px(coord);

    switch effect.mode {
        case 1u: {
            color = vec4<f32>(color.rgb * effect.p0, color.a);
        }
        case 2u: {
            color = vec4<f32>((color.rgb - vec3<f32>(0.5)) * effect.p0 + vec3<f32>(0.5), color.a);
        }
        case 3u: {
            let gray = vec3<f32>(luma(color.rgb));
            color = vec4<f32>(mix(gray, color.rgb, effect.p0), color.a);
        }
        case 4u: {
            color = sample_blur_h(coord, effect.p0);
        }
        case 5u: {
            let center = load_px(coord);
            let neighbors = load_px(coord + vec2<i32>(1, 0)) + load_px(coord + vec2<i32>(-1, 0)) + load_px(coord + vec2<i32>(0, 1)) + load_px(coord + vec2<i32>(0, -1));
            color = vec4<f32>(center.rgb + (center.rgb * 4.0 - neighbors.rgb) * effect.p0, center.a);
        }
        case 6u: {
            let size = max(effect.p0, 1.0);
            let px = vec2<i32>(i32(floor(f32(gid.x) / size) * size), i32(floor(f32(gid.y) / size) * size));
            color = load_px(px);
        }
        case 8u: {
            let d = distance(uv, vec2<f32>(0.5, 0.5));
            let mask = smoothstep(effect.p1, effect.p1 + effect.p2, d);
            color = vec4<f32>(color.rgb * (1.0 - mask * effect.p0), color.a);
        }
        case 9u: {
            let n = hash21(vec2<f32>(f32(gid.x) + f32(effect.seed), f32(gid.y) - f32(effect.seed)));
            color = vec4<f32>(color.rgb + (n - 0.5) * effect.p0, color.a);
        }
        case 10u: {
            let angle = effect.p1 * 0.017453292519943295;
            let offset = vec2<i32>(i32(round(cos(angle) * effect.p0)), i32(round(sin(angle) * effect.p0)));
            let r = load_px(coord + offset).r;
            let g = color.g;
            let b = load_px(coord - offset).b;
            color = vec4<f32>(r, g, b, color.a);
        }
        case 11u: {
            color = vec4<f32>(rotate_hue(color.rgb, effect.p0), color.a);
        }
        case 12u: {
            let in_black = effect.p0;
            let in_white = effect.p1;
            let gamma = effect.p2;
            let out_black = effect.p3;
            let out_white = effect.p4;
            let normalized = clamp((color.rgb - vec3<f32>(in_black)) / max(in_white - in_black, 0.001), vec3<f32>(0.0), vec3<f32>(1.0));
            color = vec4<f32>(mix(vec3<f32>(out_black), vec3<f32>(out_white), pow(normalized, vec3<f32>(1.0 / gamma))), color.a);
        }
        case 13u: {
            let key = vec3<f32>(effect.p0, effect.p1, effect.p2);
            let threshold = effect.p3;
            let smoothness = effect.p4;
            let diff = distance(color.rgb, key);
            color = vec4<f32>(color.rgb, color.a * smoothstep(threshold, threshold + smoothness, diff));
        }
        case 14u: {
            color = sample_blur_v(coord, effect.p0);
        }
        case 15u: {
            let bright = smoothstep(effect.p0, 1.0, luma(color.rgb));
            color = vec4<f32>(color.rgb * bright, 1.0);
        }
        case 18u: {
            // input_tex = original frame (bind_src), secondary_tex = blurred bright
            // mask (bind_secondary). Bloom = original + glow * strength.
            let orig = color;
            let bloom = load_secondary(coord);
            color = vec4<f32>(orig.rgb + bloom.rgb * effect.p1, orig.a);
        }
        default: {}
    }

    textureStore(output_tex, coord, clamp(color, vec4<f32>(0.0), vec4<f32>(1.0)));
}
