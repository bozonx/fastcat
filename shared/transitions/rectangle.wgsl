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

fn pixel_uv(gid: vec3<u32>) -> vec2<f32> {
    return (vec2<f32>(f32(gid.x), f32(gid.y)) + vec2<f32>(0.5, 0.5)) / dims();
}

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
    let aa = 1.5 / dims().y;
    let blur = max(aa, uni.p0 * select(1.0, t, uni.p1 > 0.5));
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
}
