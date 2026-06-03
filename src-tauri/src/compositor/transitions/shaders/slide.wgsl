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
    
    let dir = i32(round(uni.p0));
    var from_uv = uv;
    var to_uv = uv;
    
    if (dir == 0) { // Left
        from_uv.x = uv.x + uni.progress;
        to_uv.x = uv.x - (1.0 - uni.progress);
    } else if (dir == 1) { // Right
        from_uv.x = uv.x - uni.progress;
        to_uv.x = uv.x + (1.0 - uni.progress);
    } else if (dir == 2) { // Up
        from_uv.y = uv.y + uni.progress;
        to_uv.y = uv.y - (1.0 - uni.progress);
    } else { // Down
        from_uv.y = uv.y - uni.progress;
        to_uv.y = uv.y + (1.0 - uni.progress);
    }
    
    var final_color = vec4<f32>(0.0);
    
    let from_coord = vec2<i32>(i32(from_uv.x * f32(uni.width)), i32(from_uv.y * f32(uni.height)));
    let to_coord = vec2<i32>(i32(to_uv.x * f32(uni.width)), i32(to_uv.y * f32(uni.height)));
    
    let from_valid = from_uv.x >= 0.0 && from_uv.x <= 1.0 && from_uv.y >= 0.0 && from_uv.y <= 1.0;
    let to_valid = to_uv.x >= 0.0 && to_uv.x <= 1.0 && to_uv.y >= 0.0 && to_uv.y <= 1.0;
    
    if (to_valid) {
        final_color = textureLoad(to_tex, to_coord, 0);
    } else if (from_valid) {
        final_color = textureLoad(from_tex, from_coord, 0);
    }
    
    textureStore(output_tex, coord, final_color);
}
