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

fn luma(c: vec3<f32>) -> f32 { return dot(c, vec3<f32>(0.299, 0.587, 0.114)); }

fn pixel_uv(gid: vec3<u32>) -> vec2<f32> {
    return (vec2<f32>(f32(gid.x), f32(gid.y)) + vec2<f32>(0.5, 0.5)) / dims();
}

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
}
