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

fn unit_interval_coverage(value: f32, pixel_size: f32) -> f32 {
    return clamp(min(value, 1.0 - value) / pixel_size + 0.5, 0.0, 1.0);
}

fn get_in_weight(uv: vec2<f32>) -> f32 {
    let pixel_size = 1.0 / dims();
    let edge_x = unit_interval_coverage(uv.x, pixel_size.x);
    let edge_y = unit_interval_coverage(uv.y, pixel_size.y);
    return edge_x * edge_y;
}

fn blinds_get_strip(uv: vec2<f32>, strip_index: f32) -> vec4<f32> {
    let dir = select(-1.0, 1.0, (strip_index % 2.0) == 0.0);
    let mv = vec2<f32>(uni.p0, uni.p1) * dir;
    let from_uv = uv - mv * uni.progress;
    let to_uv = uv - mv * (uni.progress - 1.0);

    let w_from = get_in_weight(from_uv);
    let w_to = get_in_weight(to_uv);
    let total_w = w_from + w_to;
    if (total_w > 0.0) {
        let c_from = samp(from_tex, from_uv);
        let c_to = samp(to_tex, to_uv);
        let tex_color = mix(c_to, c_from, w_from / total_w);
        return mix(vec4<f32>(0.0, 0.0, 0.0, 1.0), tex_color, min(total_w, 1.0));
    }
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);
}

fn blinds_get(uv: vec2<f32>) -> vec4<f32> {
    let strip_coord = dot(uv - vec2<f32>(0.5), vec2<f32>(uni.p2, uni.p3)) + 0.5;
    let strip_position = strip_coord * uni.p4;
    let strip_index = floor(strip_position);
    let strip_fraction = fract(strip_position);
    let center_color = blinds_get_strip(uv, strip_index);

    // Box-filter the alternating strip selection over one output pixel. The
    // projected footprint keeps diagonal edges one pixel wide at any angle.
    let strip_footprint = uni.p4 * (
        abs(uni.p2) / f32(uni.width) + abs(uni.p3) / f32(uni.height)
    );
    let edge_distance = min(strip_fraction, 1.0 - strip_fraction);
    let center_coverage = clamp(edge_distance / max(strip_footprint, 0.000001) + 0.5, 0.0, 1.0);
    if (center_coverage >= 1.0) {
        return center_color;
    }

    let neighbor_index = strip_index + select(1.0, -1.0, strip_fraction < 0.5);
    let neighbor_color = blinds_get_strip(uv, neighbor_index);
    return mix(neighbor_color, center_color, center_coverage);
}

fn blinds_process(color: vec4<f32>) -> vec4<f32> {
    let env = sin(clamp(uni.progress, 0.0, 1.0) * PI);
    let brightness = uni.p10 * env;
    var extra = brightness;
    if (uni.p9 > 0.5) {
        let lum = dot(color.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
        extra = brightness * smoothstep(uni.p11, 1.0, lum);
    }
    return vec4<f32>(max(vec3<f32>(0.0), color.rgb * (1.0 + extra)), color.a);
}

fn blinds_motion(uv: vec2<f32>) -> vec4<f32> {
    // Scale motion blur by the curve's instantaneous speed, matching web rendering.
    let mb = uni.p7 * uni.speed;
    if (mb <= 0.0) { return blinds_process(blinds_get(uv)); }
    let max_samples = i32(uni.p6);
    let pixel_blur = mb * length(vec2<f32>(uni.p0, uni.p1) * dims());
    let samples = clamp(i32(ceil(pixel_blur)), 4, max_samples);
    let step_size = mb / f32(samples - 1);
    let start = -mb * 0.5;
    let strip_coord = dot(uv - vec2<f32>(0.5), vec2<f32>(uni.p2, uni.p3)) + 0.5;
    let strip_index = floor(strip_coord * uni.p4);
    let dir = select(-1.0, 1.0, (strip_index % 2.0) == 0.0);
    let blur_axis = vec2<f32>(uni.p0, uni.p1) * dir;
    var accum = vec4<f32>(0.0);
    var tw = 0.0;
    for (var i = 0; i < 64; i = i + 1) {
        if (i >= samples) { break; }
        let off = start + f32(i) * step_size;
        let c = blinds_process(blinds_get(uv + blur_axis * off));
        var w = 1.0;
        if (uni.p8 > 0.5) {
            let lum = dot(c.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
            w = smoothstep(uni.p11, 1.0, lum);
        }
        accum = accum + c * w;
        tw = tw + w;
    }
    if (tw > 0.0) { return accum / tw; }
    return blinds_process(blinds_get(uv));
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= uni.width || gid.y >= uni.height) { return; }
    let coord = vec2<i32>(i32(gid.x), i32(gid.y));
    let uv = pixel_uv(gid);
    let post_blur = uni.p5 * 0.005 * sin(clamp(uni.progress, 0.0, 1.0) * PI);

    if (post_blur <= 0.0) {
        textureStore(output_tex, coord, blinds_motion(uv));
        return;
    }

    let aspect = dims().x / dims().y;
    let blur_radius = vec2<f32>(post_blur, post_blur * aspect);
    var half_grid = 2;
    if (uni.p6 > 30.0) { half_grid = 4; }
    else if (uni.p6 > 15.0) { half_grid = 3; }
    else if (uni.p6 < 10.0) { half_grid = 1; }

    var accum = vec4<f32>(0.0);
    var tw = 0.0;
    for (var x = -4; x <= 4; x = x + 1) {
        if (x > half_grid) { break; }
        if (x < -half_grid) { continue; }
        for (var y = -4; y <= 4; y = y + 1) {
            if (y > half_grid) { break; }
            if (y < -half_grid) { continue; }
            let offset = vec2<f32>(f32(x), f32(y)) / f32(half_grid);
            accum = accum + blinds_motion(uv + offset * blur_radius);
            tw = tw + 1.0;
        }
    }
    textureStore(output_tex, coord, accum / tw);
}
