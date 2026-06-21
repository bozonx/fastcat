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

// p0,p1: wipe direction (cos/sin of angle)
// p2:    gap size (fraction of axis, only used in gap mode)
// p3:    edge softness/blur (fraction, only used in blur mode)
// p4:    edge mode flag (>0.5 == gap, else blur)
// p5,p6,p7: gap color rgb

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= uni.width || gid.y >= uni.height) {
        return;
    }
    let coord = vec2<i32>(i32(gid.x), i32(gid.y));
    let uv = vec2<f32>(f32(gid.x) / f32(uni.width), f32(gid.y) / f32(uni.height));

    let dir = normalize(vec2<f32>(uni.p0, uni.p1));
    let d = dot(uv - vec2<f32>(0.5, 0.5), dir) + 0.5;
    let progress = clamp(uni.progress, 0.0, 1.0);

    let from_color = textureLoad(from_tex, coord, 0);
    let to_color = textureLoad(to_tex, coord, 0);
    let aa = 1.5 / f32(uni.height);

    var final_color: vec4<f32>;
    if (uni.p4 < 0.5) {
        // Blur edge mode: soft crossfade across the moving edge.
        let softness = max(uni.p3, aa);
        let alpha = smoothstep(progress - softness, progress + softness, d);
        final_color = mix(to_color, from_color, alpha);
    } else {
        // Gap edge mode: solid colored band straddling the moving edge.
        let gap_half = uni.p2 * 0.5;
        let cut_start = progress - gap_half;
        let cut_end = progress + gap_half;
        let before = 1.0 - smoothstep(cut_start - aa, cut_start + aa, d);
        let after = smoothstep(cut_end - aa, cut_end + aa, d);
        let inside = 1.0 - before - after;
        let gap_color = vec4<f32>(uni.p5, uni.p6, uni.p7, 1.0);
        final_color = to_color * before + gap_color * inside + from_color * after;
    }
    textureStore(output_tex, coord, final_color);
}
