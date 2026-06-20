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

fn zoom_rotate(pt: vec2<f32>, angle: f32, aspect: f32) -> vec2<f32> {
    let c = cos(angle);
    let s = sin(angle);
    let x = pt.x * aspect;
    var r = vec2<f32>(x * c - pt.y * s, x * s + pt.y * c);
    r.x = r.x / aspect;
    return r;
}

// Source UV of a zoomed/rotated layer for a given screen UV. Pure function used
// both for the center color sample and for sub-pixel coverage supersampling.
fn layer_uv(uv: vec2<f32>, angle: f32, scale: f32, aspect: f32) -> vec2<f32> {
    return zoom_rotate(uv - vec2<f32>(0.5), angle, aspect) / scale + vec2<f32>(0.5);
}

// MSAA-style coverage of a zoomed/rotated layer over a 4x4 ordered sub-pixel
// grid. Replaces the hard step() mask so rotated layer edges are anti-aliased.
fn layer_coverage(uv: vec2<f32>, angle: f32, scale: f32, aspect: f32) -> f32 {
    let inv = 1.0 / dims();
    var cov = 0.0;
    for (var sy = 0; sy < 4; sy = sy + 1) {
        for (var sx = 0; sx < 4; sx = sx + 1) {
            let off = (vec2<f32>(f32(sx), f32(sy)) + 0.5) / 4.0 - 0.5;
            if (in_bounds(layer_uv(uv + off * inv, angle, scale, aspect))) { cov = cov + 1.0; }
        }
    }
    return cov / 16.0;
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
    let from_uv = layer_uv(uv, from_angle, from_scale, aspect);
    var from_color = zoom_sample(from_tex, from_uv, from_blur, from_bright, progress);
    let from_inside = layer_coverage(uv, from_angle, from_scale, aspect);
    from_color = from_color * ((1.0 - progress) * from_inside);

    let to_scale = mix(uni.p0, 1.0, progress);
    let to_angle = mix(uni.p2, 0.0, progress);
    let to_blur = mix(uni.p3 * 0.005, 0.0, progress);
    let to_bright = mix(1.0 + uni.p6, 1.0, progress);
    let to_uv = layer_uv(uv, to_angle, to_scale, aspect);
    var to_color = zoom_sample(to_tex, to_uv, to_blur, to_bright, 1.0 - progress);
    let to_inside = layer_coverage(uv, to_angle, to_scale, aspect);
    to_color = to_color * (progress * to_inside);

    let result = from_color + to_color;
    textureStore(output_tex, coord, vec4<f32>(result.rgb, min(result.a, 1.0)));
}
