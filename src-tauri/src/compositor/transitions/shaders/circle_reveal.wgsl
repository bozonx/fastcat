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

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= uni.width || gid.y >= uni.height) {
        return;
    }
    let coord = vec2<i32>(i32(gid.x), i32(gid.y));
    let uv = vec2<f32>(f32(gid.x) / f32(uni.width), f32(gid.y) / f32(uni.height));
    
    let aspect = f32(uni.width) / f32(uni.height);
    let center = vec2<f32>(uni.p0 * aspect, uni.p1);
    let current = vec2<f32>(uv.x * aspect, uv.y);
    
    let dist = distance(current, center);
    let max_radius = 1.5; // Enough to cover the screen from corners
    
    let softness = max(uni.p2, 0.0001);
    let threshold = uni.progress * max_radius;
    let alpha = smoothstep(threshold - softness, threshold + softness, dist);
    
    let from_color = textureLoad(from_tex, coord, 0);
    let to_color = textureLoad(to_tex, coord, 0);
    let final_color = mix(to_color, from_color, alpha);
    textureStore(output_tex, coord, final_color);
}
