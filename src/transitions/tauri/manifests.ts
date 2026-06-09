import {
  applyTransitionCurve,
  type TransitionManifest,
  type TauriTransitionSpec,
} from '../core/registry';

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const transparent = () => 1;

const ZOOM_WGSL = `@group(0) @binding(0) var from_tex: texture_2d<f32>;
@group(0) @binding(1) var to_tex: texture_2d<f32>;
@group(0) @binding(2) var output_tex: texture_storage_2d<rgba8unorm, write>;

struct TransitionUniform {
    progress: f32,
    width: u32,
    height: u32,
    pad: u32,
    p0: f32, // scale
    p1: f32, // fromRotation
    p2: f32, // toRotation
    p3: f32, // blur strength
    p4: f32, // blur samples
    p5: f32, // brightness mode (0.0=normal, 1.0=bloom)
    p6: f32, // brightness amount
    p7: f32,
};
@group(0) @binding(3) var<uniform> uni: TransitionUniform;

fn rotate(pt: vec2<f32>, angle: f32, aspect: f32) -> vec2<f32> {
    let c = cos(angle);
    let s = sin(angle);
    var rotated = vec2<f32>(pt.x * aspect, pt.y);
    rotated = vec2<f32>(rotated.x * c - rotated.y * s, rotated.x * s + rotated.y * c);
    return vec2<f32>(rotated.x / aspect, rotated.y);
}

fn sample_blur(tex: texture_2d<f32>, uv: vec2<f32>, dir: vec2<f32>, blur_amount: f32) -> vec4<f32> {
    if (blur_amount < 0.001) {
        let coord = vec2<i32>(i32(uv.x * f32(uni.width)), i32(uv.y * f32(uni.height)));
        return textureLoad(tex, coord, 0);
    }
    var sum = vec4<f32>(0.0);
    let samples = i32(clamp(uni.p4, 4.0, 32.0));
    for (var i = 0; i < samples; i = i + 1) {
        let t = f32(i) / f32(samples);
        let offset = dir * (t * blur_amount);
        let offset_uv = uv + offset;
        let coord = vec2<i32>(
            i32(clamp(offset_uv.x, 0.0, 1.0) * f32(uni.width)), 
            i32(clamp(offset_uv.y, 0.0, 1.0) * f32(uni.height))
        );
        sum = sum + textureLoad(tex, coord, 0);
    }
    return sum / f32(samples);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= uni.width || gid.y >= uni.height) {
        return;
    }
    let coord = vec2<i32>(i32(gid.x), i32(gid.y));
    let uv = vec2<f32>(f32(gid.x) / f32(uni.width), f32(gid.y) / f32(uni.height));
    let aspect = f32(uni.width) / f32(uni.height);
    let center = vec2<f32>(0.5, 0.5);
    
    let from_scale = mix(1.0, uni.p0, uni.progress);
    let from_angle = mix(0.0, uni.p1 * 0.0174532925, uni.progress);
    let from_blur = mix(0.0, uni.p3 * 0.005, uni.progress);
    
    var from_pt = uv - center;
    from_pt = rotate(from_pt, from_angle, aspect);
    let from_uv = from_pt / from_scale + center;
    
    var from_color = vec4<f32>(0.0);
    if (from_uv.x >= 0.0 && from_uv.x <= 1.0 && from_uv.y >= 0.0 && from_uv.y <= 1.0) {
        from_color = sample_blur(from_tex, from_uv, center - from_uv, from_blur);
    }
    
    let to_scale = mix(uni.p0, 1.0, uni.progress);
    let to_angle = mix(uni.p2 * 0.0174532925, 0.0, uni.progress);
    let to_blur = mix(uni.p3 * 0.005, 0.0, uni.progress);
    
    var to_pt = uv - center;
    to_pt = rotate(to_pt, to_angle, aspect);
    let to_uv = to_pt / to_scale + center;
    
    var to_color = vec4<f32>(0.0);
    if (to_uv.x >= 0.0 && to_uv.x <= 1.0 && to_uv.y >= 0.0 && to_uv.y <= 1.0) {
        to_color = sample_blur(to_tex, to_uv, center - to_uv, to_blur);
    }
    
    let peak = 1.0 - abs(uni.progress - 0.5) * 2.0;
    let bright_factor = mix(1.0, 1.0 + uni.p6, peak);
    
    var final_color = mix(from_color, to_color, uni.progress) * bright_factor;
    final_color.a = 1.0;
    textureStore(output_tex, coord, final_color);
}`;

const BLOOM_WGSL = `@group(0) @binding(0) var from_tex: texture_2d<f32>;
@group(0) @binding(1) var to_tex: texture_2d<f32>;
@group(0) @binding(2) var output_tex: texture_storage_2d<rgba8unorm, write>;

struct TransitionUniform {
    progress: f32,
    width: u32,
    height: u32,
    pad: u32,
    p0: f32, // brightness
    p1: f32, // blurLevel
    p2: f32, // isBloom (1.0 = bloom, 0.0 = normal)
    p3: f32, p4: f32, p5: f32, p6: f32, p7: f32,
};
@group(0) @binding(3) var<uniform> uni: TransitionUniform;

fn luma(color: vec3<f32>) -> f32 {
    return dot(color, vec3<f32>(0.299, 0.587, 0.114));
}

fn extract_bright(color: vec4<f32>) -> vec4<f32> {
    let luminance = luma(color.rgb);
    let threshold = 0.5;
    let intensity = smoothstep(threshold, threshold + 0.2, luminance);
    return color * intensity;
}

fn sample_blur(tex: texture_2d<f32>, coord: vec2<i32>, blur_amount: f32, is_bloom: bool) -> vec4<f32> {
    if (blur_amount < 1.0) {
        return textureLoad(tex, coord, 0);
    }
    var sum = vec4<f32>(0.0);
    var weight_sum = 0.0;
    let r = i32(clamp(blur_amount, 1.0, 8.0));
    
    for (var y = -r; y <= r; y = y + 1) {
        for (var x = -r; x <= r; x = x + 1) {
            let sample_coord = vec2<i32>(
                clamp(coord.x + x, 0, i32(uni.width) - 1),
                clamp(coord.y + y, 0, i32(uni.height) - 1)
            );
            var color = textureLoad(tex, sample_coord, 0);
            if (is_bloom) {
                color = extract_bright(color);
            }
            let dist = f32(x * x + y * y);
            let w = exp(-dist / 8.0);
            sum = sum + color * w;
            weight_sum = weight_sum + w;
        }
    }
    return sum / max(weight_sum, 0.0001);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= uni.width || gid.y >= uni.height) {
        return;
    }
    let coord = vec2<i32>(i32(gid.x), i32(gid.y));
    let peak = 1.0 - abs(uni.progress - 0.5) * 2.0;
    let blur_amount = uni.p1 * peak * 4.0;
    let is_bloom = uni.p2 > 0.5;
    
    let from_color = textureLoad(from_tex, coord, 0);
    let to_color = textureLoad(to_tex, coord, 0);
    let base_color = mix(from_color, to_color, uni.progress);
    
    if (is_bloom) {
        let bloom_from = sample_blur(from_tex, coord, blur_amount, true);
        let bloom_to = sample_blur(to_tex, coord, blur_amount, true);
        let mixed_bloom = mix(bloom_from, bloom_to, uni.progress);
        
        let out_color = base_color + mixed_bloom * uni.p0 * peak;
        textureStore(output_tex, coord, vec4<f32>(min(out_color.rgb, vec3<f32>(1.0)), base_color.a));
    } else {
        let blur_from = sample_blur(from_tex, coord, blur_amount, false);
        let blur_to = sample_blur(to_tex, coord, blur_amount, false);
        let mixed_blur = mix(blur_from, blur_to, uni.progress);
        
        let brightness_mult = mix(1.0, uni.p0, peak);
        let out_color = mixed_blur * brightness_mult;
        textureStore(output_tex, coord, vec4<f32>(min(out_color.rgb, vec3<f32>(1.0)), base_color.a));
    }
}`;

export const tauriTransitionManifests: TransitionManifest[] = [
  {
    type: 'dissolve',
    name: 'Dissolve',
    nameKey: 'fastcat.transitions.dissolve.name',
    icon: 'i-heroicons-arrows-right-left',
    defaultDurationUs: 500_000,
    defaultParams: {},
    renderMode: 'shader',
    renderer: 'wgpu',
    toTauriSpec: () => ({ type: 'crossfade' }),
    computeOutOpacity: () => 1,
    computeInOpacity: () => 1,
  },
  {
    type: 'wipe',
    name: 'Wipe',
    nameKey: 'fastcat.transitions.wipe.name',
    icon: 'i-heroicons-arrow-long-right',
    defaultDurationUs: 700_000,
    defaultParams: {
      angle: 0,
      softness: 0.08,
    },
    renderMode: 'shader',
    renderer: 'wgpu',
    paramFields: [
      {
        kind: 'slider',
        key: 'angle',
        labelKey: 'fastcat.transitions.wipe.params.angle',
        min: -180,
        max: 180,
        step: 1,
      },
      {
        kind: 'slider',
        key: 'softness',
        labelKey: 'fastcat.transitions.wipe.params.softness',
        min: 0,
        max: 1,
        step: 0.01,
      },
    ],
    toTauriSpec: (params) => ({
      type: 'wipe',
      angle_deg: clamp(finiteNumber(params.angle, 0), -180, 180),
      softness: clamp(finiteNumber(params.softness, 0.08), 0, 1),
    }),
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
  {
    type: 'slide',
    name: 'Slide',
    nameKey: 'fastcat.transitions.slide.name',
    icon: 'i-heroicons-arrows-pointing-out',
    defaultDurationUs: 700_000,
    defaultParams: {
      direction: 'left',
    },
    renderMode: 'shader',
    renderer: 'wgpu',
    paramFields: [
      {
        kind: 'select',
        key: 'direction',
        labelKey: 'fastcat.transitions.slide.params.direction',
        options: [
          { labelKey: 'fastcat.transitions.slide.options.left', value: 'left' },
          { labelKey: 'fastcat.transitions.slide.options.right', value: 'right' },
          { labelKey: 'fastcat.transitions.slide.options.up', value: 'up' },
          { labelKey: 'fastcat.transitions.slide.options.down', value: 'down' },
        ],
      },
    ],
    toTauriSpec: (params): TauriTransitionSpec => {
      const raw = params.direction;
      const direction =
        raw === 'right' || raw === 'up' || raw === 'down' || raw === 'left' ? raw : 'left';
      return { type: 'slide', direction };
    },
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
  {
    type: 'fade-to-black',
    name: 'Fade to Black',
    nameKey: 'fastcat.transitions.fade-to-black.name',
    icon: 'i-heroicons-moon',
    defaultDurationUs: 700_000,
    defaultParams: {
      color: '#000000',
    },
    renderMode: 'shader',
    renderer: 'wgpu',
    toTauriSpec: (params) => ({
      type: 'fade-through-color',
      color: typeof params.color === 'string' ? params.color : '#000000',
    }),
    computeOutOpacity: (progress, _params, curve) => {
      const t = applyTransitionCurve(progress, curve);
      return t < 0.5 ? 1 - t * 2 : 0;
    },
    computeInOpacity: (progress, _params, curve) => {
      const t = applyTransitionCurve(progress, curve);
      return t < 0.5 ? 0 : (t - 0.5) * 2;
    },
  },
  {
    type: 'circle',
    name: 'Circle Reveal',
    nameKey: 'fastcat.transitions.circle.name',
    icon: 'i-heroicons-eye',
    defaultDurationUs: 700_000,
    defaultParams: {
      centerX: 0.5,
      centerY: 0.5,
      softness: 0.08,
    },
    renderMode: 'shader',
    renderer: 'wgpu',
    paramFields: [
      {
        kind: 'slider',
        key: 'centerX',
        labelKey: 'fastcat.transitions.circle.params.centerX',
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        kind: 'slider',
        key: 'centerY',
        labelKey: 'fastcat.transitions.circle.params.centerY',
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        kind: 'slider',
        key: 'softness',
        labelKey: 'fastcat.transitions.wipe.params.softness',
        min: 0,
        max: 1,
        step: 0.01,
      },
    ],
    toTauriSpec: (params) => ({
      type: 'circle-reveal',
      center: [
        clamp(finiteNumber(params.centerX, 0.5), 0, 1),
        clamp(finiteNumber(params.centerY, 0.5), 0, 1),
      ],
      softness: clamp(finiteNumber(params.softness, 0.08), 0, 1),
    }),
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
  {
    type: 'zoom',
    name: 'Zoom',
    nameKey: 'fastcat.transitions.zoom.name',
    icon: 'i-heroicons-magnifying-glass',
    defaultDurationUs: 500_000,
    defaultParams: {
      scale: 3.0,
      fromRotation: 0,
      toRotation: 0,
      blur: 20,
      blurQuality: 'medium',
      brightnessMode: 'normal',
      brightness: 0,
    },
    renderMode: 'shader',
    renderer: 'wgpu',
    toTauriSpec: (params: Record<string, unknown>) => {
      let samples = 16.0;
      const blurQuality = params.blurQuality as string;
      if (blurQuality === 'low') samples = 8.0;
      else if (blurQuality === 'high') samples = 32.0;
      else if (blurQuality === 'ultra') samples = 64.0;

      return {
        type: 'custom-wgsl',
        source: ZOOM_WGSL,
        params: {
          p0: finiteNumber(params.scale as number, 3.0),
          p1: finiteNumber(params.fromRotation as number, 0.0),
          p2: finiteNumber(params.toRotation as number, 0.0),
          p3: finiteNumber(params.blur as number, 20.0),
          p4: samples,
          p5: params.brightnessMode === 'bloom' ? 1.0 : 0.0,
          p6: finiteNumber(params.brightness as number, 0.0),
        },
      };
    },
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
  {
    type: 'bloom',
    name: 'Bloom',
    nameKey: 'fastcat.transitions.bloom.name',
    icon: 'i-heroicons-sparkles',
    defaultDurationUs: 500_000,
    defaultParams: {
      brightness: 1.5,
      blurLevel: 1.0,
      mode: 'bloom',
    },
    renderMode: 'shader',
    renderer: 'wgpu',
    toTauriSpec: (params: Record<string, unknown>) => ({
      type: 'custom-wgsl',
      source: BLOOM_WGSL,
      params: {
        p0: finiteNumber(params.brightness as number, 1.5),
        p1: finiteNumber(params.blurLevel as number, 1.0),
        p2: params.mode === 'normal' ? 0.0 : 1.0,
      },
    }),
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
];

const tauriTransitionManifestByType = new Map(
  tauriTransitionManifests.map((manifest) => [manifest.type, manifest]),
);

export function getTauriTransitionManifest(type: string): TransitionManifest | undefined {
  return tauriTransitionManifestByType.get(type);
}
