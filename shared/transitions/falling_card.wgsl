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
    // Depth offset of the card. 'fit' is the offset that makes the near edge sit
    // exactly at the screen edge (no spill): for a forward/toward-viewer fold the
    // near edge is the falling edge (fit = s); for a backward fold the near edge
    // is the fixed hinge (fit = 0, the card just recedes). edgeOverflow (uni.p3,
    // 0..1) then pulls the whole card toward the viewer so it bleeds past the
    // screen by a controllable amount (1.0 ~= 2x magnification of the near edge).
    // It is therefore visible in BOTH depth directions.
    let overflow = clamp(uni.p3, 0.0, 1.0);
    let fit = select(0.0, s, dd < 0.0);
    let z_base = fit - overflow * s * (d * 0.5);
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
}
