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

fn is_unit_uv(uv: vec2<f32>) -> bool {
    return all(uv >= vec2<f32>(0.0)) && all(uv <= vec2<f32>(1.0));
}

fn pixel_uv(gid: vec3<u32>) -> vec2<f32> {
    return (vec2<f32>(f32(gid.x), f32(gid.y)) + vec2<f32>(0.5, 0.5)) / dims();
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= uni.width || gid.y >= uni.height) { return; }
    let coord = vec2<i32>(i32(gid.x), i32(gid.y));
    let uv = pixel_uv(gid);
    let aspect = dims().x / dims().y;
    let center = vec2<f32>(uni.p3, uni.p4);
    let scale = max(vec2<f32>(0.001), vec2<f32>(uni.p5, uni.p6));

    var centered = uv - center; centered.x = centered.x * aspect; centered = centered / scale;
    let dist = length(centered);

    var c0 = vec2<f32>(0.0, 0.0) - center; c0.x = c0.x * aspect; c0 = c0 / scale;
    var c1 = vec2<f32>(1.0, 0.0) - center; c1.x = c1.x * aspect; c1 = c1 / scale;
    var c2 = vec2<f32>(0.0, 1.0) - center; c2.x = c2.x * aspect; c2 = c2 / scale;
    var c3 = vec2<f32>(1.0, 1.0) - center; c3.x = c3.x * aspect; c3 = c3 / scale;
    let max_radius = max(max(length(c0), length(c1)), max(length(c2), length(c3)));

    let progress = clamp(uni.progress, 0.0, 1.0);
    let dir_pos = uni.p2 > 0.0;
    let t = select(1.0 - progress, progress, dir_pos);
    let radius = t * max_radius;
    // Distance is evaluated in aspect- and user-scale-corrected space. Its
    // pixel footprint follows the local SDF normal, not just the output height.
    let safe_dist = max(dist, 0.0001);
    let normal = abs(centered) / safe_dist;
    let aa = 0.5 * (normal.x / scale.x + normal.y / scale.y) / dims().y;
    let blur = select(max(aa, uni.p0 * select(1.0, t, uni.p1 > 0.5)), aa, uni.p8 > 0.5);
    // A radial SDF has no space inside the contour when the circle is smaller
    // than its blur. Clamp only that side to avoid a flat, clipped center.
    let inner_blur = min(blur, radius);
    var reveal = 1.0 - smoothstep(radius - inner_blur, radius + blur, dist);
    if (!dir_pos) { reveal = 1.0 - reveal; }

    var uv_from = uv;
    var norm_to = uv;
    if (uni.p7 > 0.5) {
        let s = min(1.0, radius * 2.0);
        if (dir_pos) { norm_to = (norm_to - center) / max(0.0001, s) + center; }
        else { uv_from = (uv_from - center) / max(0.0001, s) + center; }
    }

    var from_color = samp(from_tex, uv_from);
    var to_color = samp(to_tex, norm_to);
    // The blurred mask extends slightly beyond the zoomed content bounds. Do
    // not expose clamp-to-edge texels there: use the opposite frame instead.
    if (uni.p7 > 0.5) {
        if (dir_pos && !is_unit_uv(norm_to)) { to_color = from_color; }
        if (!dir_pos && !is_unit_uv(uv_from)) { from_color = to_color; }
    }
    var color = mix(from_color, to_color, reveal);
    if (uni.p8 > 0.5 && uni.p9 > 0.0) {
        let stroke_width = uni.p9 * select(1.0, t, uni.p8 > 1.5);
        let stroke_coverage = 1.0 - smoothstep(stroke_width * 0.5 - aa, stroke_width * 0.5 + aa, abs(dist - radius));
        color = mix(color, vec4<f32>(uni.p10, uni.p11, uni.p0, 1.0), stroke_coverage);
    }
    textureStore(output_tex, coord, color);
}
