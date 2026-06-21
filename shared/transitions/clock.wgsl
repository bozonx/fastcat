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

fn get_in_weight(uv: vec2<f32>) -> f32 {
    let aa = 1.5 / dims();
    let edge_x = smoothstep(0.0, aa.x, uv.x) * (1.0 - smoothstep(1.0 - aa.x, 1.0, uv.x));
    let edge_y = smoothstep(0.0, aa.y, uv.y) * (1.0 - smoothstep(1.0 - aa.y, 1.0, uv.y));
    return edge_x * edge_y;
}

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
    let R = length(centered);
    let aa = clamp((1.5 / dims().y) / (2.0 * PI * max(R, 0.0001)), 0.0001, 0.5);
    let blur = max(uni.p1, aa);
    let val = angle / (PI * 2.0);
    let diff = val - progress;
    let cyclic_diff = diff - round(diff);
    let reveal = smoothstep(-blur, blur, cyclic_diff);
    textureStore(output_tex, coord, mix(samp(from_tex, uv), samp(to_tex, uv), 1.0 - reveal));
}
