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

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= uni.width || gid.y >= uni.height) {
        return;
    }
    let coord = vec2<i32>(i32(gid.x), i32(gid.y));
    let from_color = textureLoad(from_tex, coord, 0);
    let to_color = textureLoad(to_tex, coord, 0);
    
    let target_color = vec4<f32>(uni.p0, uni.p1, uni.p2, 1.0);
    var final_color = vec4<f32>(0.0);
    
    if (uni.progress < 0.5) {
        let t = smoothstep(0.0, 1.0, uni.progress * 2.0);
        final_color = mix(from_color, target_color, t);
    } else {
        let t = smoothstep(0.0, 1.0, (uni.progress - 0.5) * 2.0);
        final_color = mix(target_color, to_color, t);
    }
    
    textureStore(output_tex, coord, final_color);
}
