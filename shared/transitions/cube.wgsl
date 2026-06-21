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

fn pixel_uv(gid: vec3<u32>) -> vec2<f32> {
    return (vec2<f32>(f32(gid.x), f32(gid.y)) + vec2<f32>(0.5, 0.5)) / dims();
}

// 1D coverage of the unit interval [0,1] by a box filter centered at `c` whose
// width `g` is the source coordinate's screen-space derivative (how far the coord
// travels across one output pixel). This is the exact average of the hard inside
// test over the pixel footprint, so it stays correct for any `g` — tiny (sharp
// edge) or huge (heavy foreshortening / fold singularity, where it -> 0).
fn axis_cov(c: f32, g: f32) -> f32 {
    let gg = max(g, 1e-6);
    let h = gg * 0.5;
    let lo = max(c - h, 0.0);
    let hi = min(c + h, 1.0);
    return max(hi - lo, 0.0) / gg;
}

// Analytic edge anti-aliasing: given a source UV at the pixel center (`cp`) and
// one screen-pixel away in x (`cpx`) and y (`cpy`), return the fractional [0,1]^2
// coverage. Replaces fixed N*N supersampling: ~3 map evaluations instead of 64,
// with continuous sub-pixel coverage whose ramp width follows the true derivative.
fn box_coverage(cp: vec2<f32>, cpx: vec2<f32>, cpy: vec2<f32>) -> f32 {
    let gx = length(vec2<f32>(cpx.x - cp.x, cpy.x - cp.x));
    let gy = length(vec2<f32>(cpx.y - cp.y, cpy.y - cp.y));
    return axis_cov(cp.x, gx) * axis_cov(cp.y, gy);
}

// Maps a screen UV to the two cube-face source UVs as a *continuous* function
// (no in/out gating): each face's u runs monotonically, landing in [0,1] only over
// the screen span the face actually covers and extrapolating outside it, so the
// gap and silhouette fall out of box_coverage() clipping the [0,1]^2 range. Pure
// function of the input UV so it can be evaluated at sub-pixel offsets.
struct CubePos { from_p: vec2<f32>, to_p: vec2<f32> };

fn map_cube(uv: vec2<f32>, progress: f32) -> CubePos {
    let unzoom = uni.p5 * uni.p2;
    let uz = unzoom * 2.0 * (0.5 - abs(progress - 0.5));
    let p = vec2<f32>(-uz * 0.5) + (1.0 + uz) * uv;

    let cap_p = mix(1.0, uni.p3, sin(progress * PI));
    let gap_half = uni.p4 * 0.5;
    let dx = uni.p0;
    let dy = uni.p1;

    var from_p: vec2<f32>;
    var to_p: vec2<f32>;

    if (dx < -0.5) {
        let bound = 1.0 - progress;
        let from_bound = bound - gap_half;
        let to_bound = bound + gap_half;
        let from_w = max(0.0001, from_bound);
        let to_w = max(0.0001, 1.0 - to_bound);
        let uf = p.x / from_w;
        from_p = vec2<f32>(uf, (p.y - 0.5) / mix(1.0, cap_p, uf) + 0.5);
        let ut = (p.x - to_bound) / to_w;
        to_p = vec2<f32>(ut, (p.y - 0.5) / mix(cap_p, 1.0, ut) + 0.5);
    } else if (dx > 0.5) {
        let bound = progress;
        let to_bound = bound - gap_half;
        let from_bound = bound + gap_half;
        let to_w = max(0.0001, to_bound);
        let from_w = max(0.0001, 1.0 - from_bound);
        let ut = p.x / to_w;
        to_p = vec2<f32>(ut, (p.y - 0.5) / mix(1.0, cap_p, ut) + 0.5);
        let uf = (p.x - from_bound) / from_w;
        from_p = vec2<f32>(uf, (p.y - 0.5) / mix(cap_p, 1.0, uf) + 0.5);
    } else if (dy < -0.5) {
        let bound = 1.0 - progress;
        let from_bound = bound - gap_half;
        let to_bound = bound + gap_half;
        let from_w = max(0.0001, from_bound);
        let to_w = max(0.0001, 1.0 - to_bound);
        let uf = p.y / from_w;
        from_p = vec2<f32>((p.x - 0.5) / mix(1.0, cap_p, uf) + 0.5, uf);
        let ut = (p.y - to_bound) / to_w;
        to_p = vec2<f32>((p.x - 0.5) / mix(cap_p, 1.0, ut) + 0.5, ut);
    } else {
        let bound = progress;
        let to_bound = bound - gap_half;
        let from_bound = bound + gap_half;
        let to_w = max(0.0001, to_bound);
        let from_w = max(0.0001, 1.0 - from_bound);
        let ut = p.y / to_w;
        to_p = vec2<f32>((p.x - 0.5) / mix(1.0, cap_p, ut) + 0.5, ut);
        let uf = (p.y - from_bound) / from_w;
        from_p = vec2<f32>((p.x - 0.5) / mix(cap_p, 1.0, uf) + 0.5, uf);
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
    // cheap geometry coverage is anti-aliased. uni.p6 selects the path: <=1 for
    // low/medium preview (hard edge, no AA), >1 for high/ultra (analytic AA).
    let center = map_cube(uv, progress);
    let from_color = samp(from_tex, center.from_p);
    let to_color = samp(to_tex, center.to_p);

    var cov_from: f32;
    var cov_to: f32;
    if (uni.p6 > 1.5) {
        let inv = 1.0 / dims();
        let px = map_cube(uv + vec2<f32>(inv.x, 0.0), progress);
        let py = map_cube(uv + vec2<f32>(0.0, inv.y), progress);
        cov_from = box_coverage(center.from_p, px.from_p, py.from_p);
        cov_to = box_coverage(center.to_p, px.to_p, py.to_p);
    } else {
        cov_from = select(0.0, 1.0, in_bounds(center.from_p));
        cov_to = select(0.0, 1.0, in_bounds(center.to_p));
    }

    // Premultiplied-style accumulation (rgb scaled by coverage), matching how the
    // outer silhouette fades to the black background.
    let color = from_color * cov_from + to_color * cov_to;
    textureStore(output_tex, coord, color);
}
