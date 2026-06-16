// =============================================================================
// Shared video-effect compute shader (cross-backend ABI).
//
// This is the SINGLE source of effect math for both backends:
//   - native: `EffectPipeline` in `src-tauri/src/compositor/effects/mod.rs`
//     (`include_str!` of this file);
//   - web: the WebGPU compute runner (imported via Vite `?raw`).
//
// ABI — do not break without updating BOTH backends and the plugin contract:
//   @group(0) @binding(0) input_tex      : texture_2d<f32>            (read, filterable)
//   @group(0) @binding(1) output_tex     : texture_storage_2d<rgba8unorm, write>
//   @group(0) @binding(2) effect         : EffectUniform (uniform, dynamic offset)
//   @group(0) @binding(3) secondary_tex  : texture_2d<f32>            (read, filterable)
//   @group(0) @binding(4) samp           : sampler (linear, clamp-to-edge)
//   entry point: `main`, @workgroup_size(8, 8, 1)
//
// EffectUniform layout (must match the Rust `EffectUniform` struct byte-for-byte):
//   mode: u32, width: u32, height: u32, seed: u32, p0..p7: f32
//
// Mode codes (set by the pass builder; see Rust `build_passes`/`effect_to_pass`):
//   0  custom WGSL (plugins; replaced by a custom pipeline, this is a no-op here)
//   1  brightness (p0)              2  contrast (p0)            3  saturation (p0)
//   4  gaussian blur horizontal (p0=radius px)
//   5  sharpen (p0=amount, p1=step px)
//   6  pixelate (p0=size, p1=mix)
//   8  vignette (p0=strength, p1=radius, p2=softness, p3=mix)
//   9  noise (p0=amount, p1=type, p2=scale, p3=mix, seed)
//   10 chromatic aberration (p0=amount px, p1=angle_deg, p2=mix)
//   11 hue rotation (p0=degrees)    12 levels (p0..p4, p5=mix)
//   13 chroma key (p0..p2=key rgb, p3=threshold, p4=smoothness)
//   14 gaussian blur vertical (p0=radius px)
//   15 bloom bright-pass extract (p0=threshold, p1=knee)
//   18 bloom compose (input=running image, secondary=blurred mask, p1=strength)
//   19 mix with secondary (p0=mix) — blends input_tex over secondary_tex
//   20 blur-fill cover place (p0=input_w, p1=input_h, p2=bg_scale) — samples
//      input_tex cover-fit into the (frame-sized) output so it fills the frame
//   21 blur-fill compose (input_tex=sharp source, secondary_tex=blurred bg;
//      p0=input_w, p1=input_h, p2=fg_scale, p3=fg_offset_y (frac of frame H),
//      p4=bg_dim (0..1), p5=bg_saturation (0..2)) — composites a contain-fit
//      sharp foreground over the dimmed/desaturated blurred background
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
@group(0) @binding(4) var samp: sampler;

// Maximum gaussian taps per side. The kernel always spans the full requested
// radius; for radii larger than this budget the step between taps grows and
// bilinear filtering interpolates between texels, so large/animated radii stay
// smooth (no banding, no per-frame popping) instead of aliasing.
const MAX_BLUR_TAPS: i32 = 48;

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

fn texel_size() -> vec2<f32> {
    return vec2<f32>(1.0 / max(f32(effect.width), 1.0), 1.0 / max(f32(effect.height), 1.0));
}

// Bilinear sample of the primary input in normalized UV space (clamp-to-edge).
fn sample_uv(uv: vec2<f32>) -> vec4<f32> {
    return textureSampleLevel(input_tex, samp, uv, 0.0);
}

fn luma(color: vec3<f32>) -> f32 {
    return dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn hash21(p: vec2<f32>) -> f32 {
    let q = fract(vec3<f32>(p.x, p.y, p.x) * vec3<f32>(0.1031, 0.1030, 0.0973));
    let r = q + dot(q, q.yzx + vec3<f32>(33.33));
    return fract((r.x + r.y) * r.z);
}

fn hash22(p: vec2<f32>) -> vec2<f32> {
    let q = fract(vec3<f32>(p.x, p.y, p.x) * vec3<f32>(0.1031, 0.1030, 0.0973));
    let r = q + dot(q, q.yzx + vec3<f32>(33.33));
    return fract((r.xx + r.yz) * r.zy) * 2.0 - 1.0;
}

fn hash31(p: vec3<f32>) -> f32 {
    let q = fract(p * vec3<f32>(0.1031, 0.1030, 0.0973));
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

// 2D Perlin (Gradient) Noise mapped to [0, 1]
fn perlin_noise(p: vec2<f32>) -> f32 {
    let ip = floor(p);
    let fp = fract(p);
    let u = fp * fp * (3.0 - 2.0 * fp);

    let g00 = dot(hash22(ip + vec2<f32>(0.0, 0.0)), fp - vec2<f32>(0.0, 0.0));
    let g10 = dot(hash22(ip + vec2<f32>(1.0, 0.0)), fp - vec2<f32>(1.0, 0.0));
    let g01 = dot(hash22(ip + vec2<f32>(0.0, 1.0)), fp - vec2<f32>(0.0, 1.0));
    let g11 = dot(hash22(ip + vec2<f32>(1.0, 1.0)), fp - vec2<f32>(1.0, 1.0));

    let n = mix(mix(g00, g10, u.x), mix(g01, g11, u.x), u.y);
    return n * 0.5 + 0.5;
}

// 2D Simplex Noise mapped to [0, 1]
fn simplex_noise(p: vec2<f32>) -> f32 {
    let C = vec4<f32>(0.211324865405187,  // (3.0-sqrt(3.0))/6.0
                      0.366025403784439,  // 0.5*(sqrt(3.0)-1.0)
                     -0.577350269189626,  // -1.0 + 2.0 * C.x
                      0.024390243902439); // 1.0 / 41.0
    var i  = floor(p + dot(p, C.yy) );
    let x0 = p -   i + dot(i, C.xx) ;

    var i1: vec2<f32>;
    if (x0.x > x0.y) {
        i1 = vec2<f32>(1.0, 0.0);
    } else {
        i1 = vec2<f32>(0.0, 1.0);
    }
    let x1 = x0.xy - i1 + C.xx;
    let x2 = x0.xy + C.zz;

    let i_mod = i - floor(i * (1.0 / 289.0)) * 289.0;
    let h0 = hash22(i_mod);
    let h1 = hash22(i_mod + i1);
    let h2 = hash22(i_mod + vec2<f32>(1.0, 1.0));

    let g0 = dot(h0, x0);
    let g1 = dot(h1, x1);
    let g2 = dot(h2, x2);

    var m = max(0.5 - vec3<f32>(dot(x0, x0), dot(x1, x1), dot(x2, x2)), vec3<f32>(0.0));
    m = m * m;
    m = m * m;

    let n = dot(m, vec3<f32>(g0, g1, g2));
    return clamp(70.0 * n * 0.5 + 0.5, 0.0, 1.0);
}

// Separable gaussian along an arbitrary axis (`dir` is a unit vector in UV px:
// (1,0) horizontal, (0,1) vertical). Uses bilinear sampling at floating
// positions so the kernel is continuous in `radius`.
fn gaussian_blur(uv: vec2<f32>, radius: f32, dir: vec2<f32>) -> vec4<f32> {
    let safe_radius = max(radius, 0.0);
    if (safe_radius < 0.5) {
        return sample_uv(uv);
    }
    let taps = i32(clamp(ceil(safe_radius), 1.0, f32(MAX_BLUR_TAPS)));
    let step = safe_radius / f32(taps); // texel-space spacing between taps
    let sigma = max(safe_radius * 0.5, 1.0);
    let double_sigma_sq = 2.0 * sigma * sigma;
    let texel = texel_size();
    var sum = vec4<f32>(0.0);
    var weight_sum = 0.0;
    for (var i = -taps; i <= taps; i = i + 1) {
        let dist = f32(i) * step; // in texels
        let w = exp(-(dist * dist) / double_sigma_sq);
        let sample_pos = uv + dir * dist * texel;
        sum += sample_uv(sample_pos) * w;
        weight_sum += w;
    }
    return sum / max(weight_sum, 0.0001);
}

// Separable box blur along an arbitrary axis.
fn box_blur(uv: vec2<f32>, radius: f32, dir: vec2<f32>) -> vec4<f32> {
    let safe_radius = max(radius, 0.0);
    if (safe_radius < 0.5) {
        return sample_uv(uv);
    }
    let taps = i32(clamp(ceil(safe_radius), 1.0, f32(MAX_BLUR_TAPS)));
    let step = safe_radius / f32(taps);
    let texel = texel_size();
    var sum = vec4<f32>(0.0);
    var weight_sum = 0.0;
    for (var i = -taps; i <= taps; i = i + 1) {
        let dist = f32(i) * step;
        let sample_pos = uv + dir * dist * texel;
        sum += sample_uv(sample_pos);
        weight_sum += 1.0;
    }
    return sum / max(weight_sum, 0.0001);
}

// Radial blur centered around (0.5, 0.5) with sharpness at the center.
fn radial_blur(uv: vec2<f32>, radius: f32) -> vec4<f32> {
    let center = vec2<f32>(0.5, 0.5);
    let dir = uv - center;
    let dist = length(dir);
    let safe_radius = max(radius * dist, 0.0);
    if (safe_radius < 0.5) {
        return sample_uv(uv);
    }
    let norm_dir = dir / max(dist, 0.0001);
    let taps = i32(clamp(ceil(safe_radius), 1.0, f32(MAX_BLUR_TAPS)));
    let step = safe_radius / f32(taps);
    let texel = texel_size();
    var sum = vec4<f32>(0.0);
    var weight_sum = 0.0;
    for (var i = -taps; i <= taps; i = i + 1) {
        let dist_val = f32(i) * step;
        let sample_pos = uv + norm_dir * dist_val * texel;
        sum += sample_uv(sample_pos);
        weight_sum += 1.0;
    }
    return sum / max(weight_sum, 0.0001);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= effect.width || gid.y >= effect.height) {
        return;
    }
    let coord = vec2<i32>(i32(gid.x), i32(gid.y));
    let texel = texel_size();
    // Sample at pixel centers so bilinear taps land exactly on texels at zero offset.
    let uv = (vec2<f32>(f32(gid.x), f32(gid.y)) + vec2<f32>(0.5)) * texel;
    var color = load_px(coord);
    let original = color;

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
            if (effect.p1 >= 1.5) {
                color = radial_blur(uv, effect.p0);
            } else if (effect.p1 >= 0.5) {
                color = box_blur(uv, effect.p0, vec2<f32>(1.0, 0.0));
            } else {
                color = gaussian_blur(uv, effect.p0, vec2<f32>(1.0, 0.0));
            }
        }
        case 5u: {
            let step = max(effect.p1, 1.0);
            let center = color.rgb;
            let neighbors = sample_uv(uv + vec2<f32>(step, 0.0) * texel).rgb
                + sample_uv(uv - vec2<f32>(step, 0.0) * texel).rgb
                + sample_uv(uv + vec2<f32>(0.0, step) * texel).rgb
                + sample_uv(uv - vec2<f32>(0.0, step) * texel).rgb;
            if (effect.p0 >= 0.0) {
                color = vec4<f32>(center + (center * 4.0 - neighbors) * effect.p0, color.a);
            } else {
                // For negative amount, soften by blending towards the neighbor average.
                // We clamp the blend factor to [0.0, 1.0] to prevent negative weights
                // which cause phase-inversion artifacts (outlines/contours).
                let blend = min(-effect.p0, 1.0);
                color = vec4<f32>(mix(center, neighbors * 0.25, blend), color.a);
            }
            color = mix(original, color, clamp(effect.p2, 0.0, 1.0));
        }
        case 6u: {
            let size = max(effect.p0, 1.0);
            let px = vec2<i32>(i32(floor(f32(gid.x) / size) * size), i32(floor(f32(gid.y) / size) * size));
            let original = color;
            color = mix(original, load_px(px), clamp(effect.p1, 0.0, 1.0));
        }
        case 8u: {
            // Aspect-correct radial distance so the vignette is circular, not
            // stretched, on non-square frames.
            let aspect = f32(effect.width) / max(f32(effect.height), 1.0);
            let centered = (uv - vec2<f32>(0.5)) * vec2<f32>(aspect, 1.0);
            let d = length(centered) / max(0.5 * sqrt(aspect * aspect + 1.0), 0.0001);
            let mask = smoothstep(effect.p1, effect.p1 + effect.p2, d);
            color = vec4<f32>(color.rgb * (1.0 - mask * effect.p0), color.a);
            color = mix(original, color, clamp(effect.p3, 0.0, 1.0));
        }
        case 9u: {
            var n: f32 = 0.0;
            let seed_val = f32(effect.seed);
            let scale_val = select(10.0, effect.p2, effect.p2 > 0.0);
            if (effect.p1 >= 1.5) {
                let seed_x = hash21(vec2<f32>(seed_val, 1.0)) * 1000.0;
                let seed_y = hash21(vec2<f32>(seed_val, 2.0)) * 1000.0;
                let p = vec2<f32>(f32(gid.x) + seed_x, f32(gid.y) + seed_y) / scale_val;
                n = simplex_noise(p);
            } else if (effect.p1 >= 0.5) {
                let seed_x = hash21(vec2<f32>(seed_val, 1.0)) * 1000.0;
                let seed_y = hash21(vec2<f32>(seed_val, 2.0)) * 1000.0;
                let p = vec2<f32>(f32(gid.x) + seed_x, f32(gid.y) + seed_y) / scale_val;
                n = perlin_noise(p);
            } else {
                n = hash31(vec3<f32>(f32(gid.x), f32(gid.y), seed_val));
            }
            color = vec4<f32>(color.rgb + (n - 0.5) * effect.p0, color.a);
            color = mix(original, color, clamp(effect.p3, 0.0, 1.0));
        }
        case 10u: {
            let angle = effect.p1 * 0.017453292519943295;
            let offset = vec2<f32>(cos(angle), sin(angle)) * effect.p0 * texel;
            let r = sample_uv(uv + offset).r;
            let g = color.g;
            let b = sample_uv(uv - offset).b;
            color = vec4<f32>(r, g, b, color.a);
            color = mix(original, color, clamp(effect.p2, 0.0, 1.0));
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
            color = mix(original, color, clamp(effect.p5, 0.0, 1.0));
        }
        case 13u: {
            let key = vec3<f32>(effect.p0, effect.p1, effect.p2);
            let threshold = effect.p3;
            let smoothness = effect.p4;
            let diff = distance(color.rgb, key);
            color = vec4<f32>(color.rgb, color.a * smoothstep(threshold, threshold + smoothness, diff));
        }
        case 14u: {
            if (effect.p1 >= 1.5) {
                color = load_px(coord);
            } else if (effect.p1 >= 0.5) {
                color = box_blur(uv, effect.p0, vec2<f32>(0.0, 1.0));
            } else {
                color = gaussian_blur(uv, effect.p0, vec2<f32>(0.0, 1.0));
            }
        }
        case 15u: {
            // Bright-pass extract with a soft knee. p0 = threshold, p1 = knee
            // width. With knee≈0 this is a hard threshold (only the
            // over-threshold luminance contributes); a wider knee ramps
            // mid-bright pixels in smoothly so the glow has a soft, controllable
            // falloff instead of a hard on/off edge. The over-threshold portion
            // is kept proportional (max(soft, l-threshold)/l) so a strong, wide
            // blur still has real energy to spread rather than a tiny clamped
            // sliver — this is what lets a *weak* glow read at a *large* radius.
            let l = luma(color.rgb);
            let knee = max(effect.p1, 0.0001);
            let soft = clamp(l - effect.p0 + knee, 0.0, 2.0 * knee);
            let soft_contrib = (soft * soft) / (4.0 * knee);
            let contrib = max(soft_contrib, l - effect.p0) / max(l, 0.0001);
            color = vec4<f32>(color.rgb * max(contrib, 0.0), 1.0);
        }
        case 18u: {
            // input_tex = running image (bind_src), secondary_tex = blurred bright
            // mask (bind_secondary). Bloom = running image + glow * strength.
            let orig = color;
            let bloom = load_secondary(coord);
            color = vec4<f32>(orig.rgb + bloom.rgb * effect.p1, orig.a);
        }
        case 19u: {
            // Blend effect result (input_tex) over the original (secondary_tex).
            color = mix(load_secondary(coord), color, clamp(effect.p0, 0.0, 1.0));
        }
        case 20u: {
            // Cover-fit the source (input_tex, native size p0×p1) into the
            // frame-sized output so it fills the frame edge-to-edge, optionally
            // zoomed further by p2. This becomes the background plate that the
            // subsequent blur passes operate on. Sampled with the clamp-to-edge
            // linear sampler, so any uncovered margin (bg_scale < 1) clamps.
            let iw = max(effect.p0, 1.0);
            let ih = max(effect.p1, 1.0);
            let bg_scale = max(effect.p2, 0.01);
            let fw = f32(effect.width);
            let fh = f32(effect.height);
            let k = max(fw / iw, fh / ih) * bg_scale;
            let dispw = iw * k;
            let disph = ih * k;
            let ox = f32(gid.x) + 0.5;
            let oy = f32(gid.y) + 0.5;
            let u = (ox - (fw - dispw) * 0.5) / dispw;
            let v = (oy - (fh - disph) * 0.5) / disph;
            color = textureSampleLevel(input_tex, samp, vec2<f32>(u, v), 0.0);
        }
        case 21u: {
            // Blur-fill compose. secondary_tex = blurred background (already
            // frame-sized, from mode 20 + blur); input_tex = the sharp source at
            // its native size (p0×p1). The background is desaturated (p5) and
            // dimmed (p4) so the foreground reads; the foreground is contain-fit
            // (scaled by p2, shifted vertically by p3) and composited on top.
            let iw = max(effect.p0, 1.0);
            let ih = max(effect.p1, 1.0);
            let fg_scale = max(effect.p2, 0.01);
            let off_y = effect.p3;
            let bg_dim = effect.p4;
            let bg_sat = effect.p5;
            let fw = f32(effect.width);
            let fh = f32(effect.height);
            var bg = load_secondary(coord).rgb;
            bg = mix(vec3<f32>(luma(bg)), bg, bg_sat);
            bg = bg * bg_dim;
            let k = min(fw / iw, fh / ih) * fg_scale;
            let dispw = iw * k;
            let disph = ih * k;
            let ox = f32(gid.x) + 0.5;
            let oy = f32(gid.y) + 0.5;
            let u = (ox - (fw - dispw) * 0.5) / dispw;
            let v = (oy - ((fh - disph) * 0.5 + off_y * fh)) / disph;
            var outc = vec3<f32>(bg);
            if (u >= 0.0 && u <= 1.0 && v >= 0.0 && v <= 1.0) {
                let fg = textureSampleLevel(input_tex, samp, vec2<f32>(u, v), 0.0);
                outc = mix(bg, fg.rgb, fg.a);
            }
            color = vec4<f32>(outc, 1.0);
        }
        default: {}
    }

    textureStore(output_tex, coord, clamp(color, vec4<f32>(0.0), vec4<f32>(1.0)));
}
