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

fn get_in_weight(uv: vec2<f32>) -> f32 {
    let aa = 1.5 / vec2<f32>(f32(uni.width), f32(uni.height));
    let edge_x = smoothstep(0.0, aa.x, uv.x) * (1.0 - smoothstep(1.0 - aa.x, 1.0, uv.x));
    let edge_y = smoothstep(0.0, aa.y, uv.y) * (1.0 - smoothstep(1.0 - aa.y, 1.0, uv.y));
    return edge_x * edge_y;
}

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
    
    let wx = f32(uni.width) - 1.0;
    let hx = f32(uni.height) - 1.0;
    let from_coord = vec2<i32>(
        i32(clamp(from_uv.x * f32(uni.width), 0.0, wx)),
        i32(clamp(from_uv.y * f32(uni.height), 0.0, hx))
    );
    let to_coord = vec2<i32>(
        i32(clamp(to_uv.x * f32(uni.width), 0.0, wx)),
        i32(clamp(to_uv.y * f32(uni.height), 0.0, hx))
    );

    let w_from = get_in_weight(from_uv);
    let w_to = get_in_weight(to_uv);
    let total_w = w_from + w_to;
    
    var final_color = vec4<f32>(0.0, 0.0, 0.0, 1.0);
    if (total_w > 0.0) {
        let c_from = textureLoad(from_tex, from_coord, 0);
        let c_to = textureLoad(to_tex, to_coord, 0);
        let tex_color = mix(c_to, c_from, w_from / total_w);
        final_color = mix(vec4<f32>(0.0, 0.0, 0.0, 1.0), tex_color, min(total_w, 1.0));
    }

    // p1: gap size, p2/p3/p4: gap color. A solid band painted over the seam
    // between the outgoing/incoming clips so they appear separated by a gap.
    if (uni.p1 > 0.0) {
        let gap_half = uni.p1 * 0.5;
        var coord_a: f32;
        var seam: f32;
        if (dir == 0) { coord_a = uv.x; seam = 1.0 - uni.progress; }
        else if (dir == 1) { coord_a = uv.x; seam = uni.progress; }
        else if (dir == 2) { coord_a = uv.y; seam = 1.0 - uni.progress; }
        else { coord_a = uv.y; seam = uni.progress; }
        let aa = select(1.5 / f32(uni.width), 1.5 / f32(uni.height), dir >= 2);
        let band = 1.0 - smoothstep(gap_half - aa, gap_half + aa, abs(coord_a - seam));
        let gap_color = vec4<f32>(uni.p2, uni.p3, uni.p4, 1.0);
        final_color = mix(final_color, gap_color, band);
    }

    textureStore(output_tex, coord, final_color);
}
