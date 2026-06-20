@group(0) @binding(0) var from_tex: texture_2d<f32>;
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

// Maps a screen-space UV to the two card UV positions (from / to). Pure function
// of the input UV so it can be evaluated at sub-pixel offsets for MSAA-style
// edge coverage supersampling.
struct CardPos { pfr: vec2<f32>, pto: vec2<f32> };

fn map_cards(uv_in: vec2<f32>, dir_h: bool, mode_slide: bool, sign_order: f32, progress: f32) -> CardPos {
    let depth = 3.0;
    let perspective = 0.2;
    var p = uv_in;
    if (sign_order < 0.0) {
        if (dir_h) { p.x = 1.0 - p.x; } else { p.y = 1.0 - p.y; }
    }
    var pfr = vec2<f32>(-1.0);
    var pto = vec2<f32>(-1.0);
    if (mode_slide) {
        let dirv = select(vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), dir_h);
        let mag = select(1.0 - progress, progress, progress < 0.5);
        pfr = p + dirv * mag;
        pto = p - dirv * mag;
    } else {
        let size_fr = mix(1.0, depth, progress);
        let persp_fr = perspective * progress;
        let size_to = mix(1.0, depth, 1.0 - progress);
        let persp_to = perspective * (1.0 - progress);
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
    return CardPos(pfr, pto);
}

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

    let dir_h = uni.p0 > 0.5;
    let mode_slide = uni.p1 > 0.5;
    let order_rev = uni.p2 > 0.5;
    let sign_order = select(1.0, -1.0, order_rev);

    let center_uv = pixel_uv(gid);
    let cp = map_cards(center_uv, dir_h, mode_slide, sign_order, progress);
    let pfr = cp.pfr;
    let pto = cp.pto;

    var size_fr = 1.0;
    var size_to = 1.0;
    var dark_fr = 0.0;
    var dark_to = 0.0;
    if (mode_slide) {
        dark_fr = select(uni.p3 * (2.0 * progress - 1.0), 0.0, progress < 0.5);
        dark_to = select(0.0, uni.p3 * (1.0 - 2.0 * progress), progress < 0.5);
    } else {
        size_fr = mix(1.0, depth, progress);
        size_to = mix(1.0, depth, 1.0 - progress);
        dark_fr = uni.p3 * progress;
        dark_to = uni.p3 * (1.0 - progress);
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

    // MSAA-style edge coverage: evaluate the card geometry at a 4x4 ordered grid
    // of sub-pixel offsets and average the in/out test. This anti-aliases the
    // rotated/perspective card silhouettes correctly at any angle (unlike a
    // fixed UV-space ramp, which collapses to sub-pixel under foreshortening).
    // Only the cheap geometry math is supersampled; texture color is sampled
    // once at the pixel center below.
    let inv = 1.0 / dims();
    var cov_fr = 0.0;
    var cov_to = 0.0;
    for (var sy = 0; sy < 4; sy = sy + 1) {
        for (var sx = 0; sx < 4; sx = sx + 1) {
            let off = (vec2<f32>(f32(sx), f32(sy)) + 0.5) / 4.0 - 0.5;
            let scp = map_cards(center_uv + off * inv, dir_h, mode_slide, sign_order, progress);
            if (in_bounds(scp.pfr)) { cov_fr = cov_fr + 1.0; }
            if (in_bounds(scp.pto)) { cov_to = cov_to + 1.0; }
        }
    }
    cov_fr = cov_fr / 16.0;
    cov_to = cov_to / 16.0;

    let max_samples = i32(uni.p7);
    var final_c_fr = vec4<f32>(0.0);
    var final_c_to = vec4<f32>(0.0);

    if (mode_slide) {
        let blur_dir = select(vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), dir_h);
        // Scale motion blur by the curve's instantaneous speed so it grows and fades
        // with the easing (matching slide/blinds). Without this the blur snapped on
        // at full strength regardless of the chosen curve.
        let blur_amount = uni.p6 * 0.1 * uni.speed;
        // Scale sample count by pixel blur length
        let pixel_blur = blur_amount * length(blur_dir * dims());
        let samples = clamp(i32(ceil(pixel_blur)), 4, max_samples);
        let f_samples = f32(samples);
        if (cov_fr > 0.0) { final_c_fr = card_blur_slide(from_tex, pfr, blur_dir, blur_amount, samples, f_samples, dark_fr); }
        if (cov_to > 0.0) { final_c_to = card_blur_slide(to_tex, pto, blur_dir, blur_amount, samples, f_samples, dark_to); }
    } else {
        let blur_fr = uni.p6 * (size_fr - 1.0) * 0.02;
        let blur_to = uni.p6 * (size_to - 1.0) * 0.02;
        let samples_fr = clamp(i32(ceil(blur_fr * max(dims().x, dims().y))), 4, max_samples);
        let samples_to = clamp(i32(ceil(blur_to * max(dims().x, dims().y))), 4, max_samples);
        if (cov_fr > 0.0) { final_c_fr = card_blur_radial(from_tex, pfr, blur_fr, samples_fr, f32(samples_fr), dark_fr); }
        if (cov_to > 0.0) { final_c_to = card_blur_radial(to_tex, pto, blur_to, samples_to, f32(samples_to), dark_to); }
    }

    var final_color = vec4<f32>(0.0);
    if (progress < 0.5) {
        // Bottom card (to) darkened by the shadow cast from the top card (from).
        let total_dark = min(1.0, dark_to + shadow_fr);
        let bottom = vec4<f32>(final_c_to.rgb * (1.0 - total_dark) / max(1.0 - dark_to, 0.001), final_c_to.a);
        final_color = mix(vec4<f32>(0.0), bottom, cov_to);
        final_color = mix(final_color, final_c_fr, cov_fr);
    } else {
        // Bottom card (from) darkened by the shadow cast from the top card (to).
        let total_dark = min(1.0, dark_fr + shadow_to);
        let bottom = vec4<f32>(final_c_fr.rgb * (1.0 - total_dark) / max(1.0 - dark_fr, 0.001), final_c_fr.a);
        final_color = mix(vec4<f32>(0.0), bottom, cov_fr);
        final_color = mix(final_color, final_c_to, cov_to);
    }
    textureStore(output_tex, coord, final_color);
}
