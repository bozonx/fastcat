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

// Maps a screen UV to the two cube-face source UVs. Faces not covering the pixel
// are returned as (-1) so in_bounds() reports them as outside. Pure function of
// the input UV so it can be evaluated at sub-pixel offsets for supersampling.
struct CubePos { from_p: vec2<f32>, to_p: vec2<f32> };

fn map_cube(uv: vec2<f32>, progress: f32) -> CubePos {
    let unzoom = uni.p5 * uni.p2;
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

    return CubePos(from_p, to_p);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= uni.width || gid.y >= uni.height) { return; }
    let coord = vec2<i32>(i32(gid.x), i32(gid.y));
    let uv = pixel_uv(gid);
    let progress = clamp(uni.progress, 0.0, 1.0);

    // Color is sampled once per face at the pixel center (bilinear); only the
    // cheap in/out geometry test is supersampled. Decoupling them lets the
    // coverage run at a high rate without multiplying texture fetches. A fixed
    // UV-space ramp collapses to sub-pixel under perspective foreshortening, and
    // a low sample count leaves coarse stair-steps on the shallow top/bottom
    // edges. The grid size is controlled by the preview quality tier via uni.p6:
    // 1x1 for low/medium (no anti-aliasing) and 8x8 for high/ultra.
    let center = map_cube(uv, progress);
    let from_color = samp(from_tex, center.from_p);
    let to_color = samp(to_tex, center.to_p);

    let inv = 1.0 / dims();
    let ss = i32(clamp(uni.p6, 1.0, 8.0));
    let inv_ss = 1.0 / f32(ss);
    var cov_from = 0.0;
    var cov_to = 0.0;
    for (var sy = 0; sy < ss; sy = sy + 1) {
        for (var sx = 0; sx < ss; sx = sx + 1) {
            let off = (vec2<f32>(f32(sx), f32(sy)) + 0.5) * inv_ss - 0.5;
            let cp = map_cube(uv + off * inv, progress);
            if (in_bounds(cp.from_p)) { cov_from = cov_from + 1.0; }
            if (in_bounds(cp.to_p)) { cov_to = cov_to + 1.0; }
        }
    }
    let total = f32(ss * ss);
    cov_from = cov_from / total;
    cov_to = cov_to / total;

    // Premultiplied-style accumulation (rgb scaled by coverage), matching how the
    // outer silhouette fades to the black background.
    let color = from_color * cov_from + to_color * cov_to;
    textureStore(output_tex, coord, color);
}
