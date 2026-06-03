@group(0) @binding(0) var from_tex: texture_2d<f32>;
@group(0) @binding(1) var to_tex: texture_2d<f32>;
@group(0) @binding(2) var output_tex: texture_storage_2d<rgba8unorm, write>;

struct TransitionUniform {
    progress: f32,
    width: u32,
    height: u32,
    pad: u32,
    p0: f32, p1: f32, p2: f32, p3: f32,
    p4: f32, p5: f32, p6: f32, p7: f32,
};
@group(0) @binding(3) var<uniform> uni: TransitionUniform;

fn hash21(p: vec2<f32>) -> f32 {
    let q = fract(vec3<f32>(p.x, p.y, p.x) * vec3<f32>(0.1031 + uni.p0 * 0.0001, 0.1030 + uni.p0 * 0.0001, 0.0973));
    let r = q + dot(q, q.yzx + vec3<f32>(33.33));
    return fract((r.x + r.y) * r.z);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= uni.width || gid.y >= uni.height) {
        return;
    }
    let coord = vec2<i32>(i32(gid.x), i32(gid.y));
    let uv = vec2<f32>(f32(gid.x) / f32(uni.width), f32(gid.y) / f32(uni.height));
    
    let from_color = textureLoad(from_tex, coord, 0);
    let to_color = textureLoad(to_tex, coord, 0);
    
    let noise = hash21(uv * 1000.0);
    let final_color = mix(from_color, to_color, step(noise, uni.progress));
    textureStore(output_tex, coord, final_color);
}
