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

    let w_from = get_in_weight(from_p);
    let w_to = get_in_weight(to_p);
    let total_w = w_from + w_to;
    var color = vec4<f32>(0.0);
    if (total_w > 0.0) {
        let c_from = samp(from_tex, from_p);
        let c_to = samp(to_tex, to_p);
        color = mix(c_to, c_from, w_from / total_w) * min(total_w, 1.0);
    }
    textureStore(output_tex, coord, color);
}
