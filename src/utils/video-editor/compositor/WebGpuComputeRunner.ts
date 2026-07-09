import type { VideoEffectSpec } from '~/types/generated/native-monitor/VideoEffectSpec';
import type { TransitionSpec } from '~/transitions';
import type { RenderTexture } from 'pixi.js';
import effectWgsl from '~shared/effects/effect.wgsl?raw';
import crossfadeWgsl from '~shared/transitions/crossfade.wgsl?raw';
import fadeThroughColorWgsl from '~shared/transitions/fade_through_color.wgsl?raw';
import slideWgsl from '~shared/transitions/slide.wgsl?raw';
import wipeWgsl from '~shared/transitions/wipe.wgsl?raw';
import { createDevLogger } from '~/utils/dev-logger';
import {
  previewEffectQualityTapBudget,
  type PreviewEffectQuality,
} from '~/utils/preview-effect-quality';
import {
  MAX_BLUR_RADIUS,
  MAX_BLOOM_RADIUS,
  MAX_COLOR_MULTIPLIER,
  MAX_BLOOM_STRENGTH,
  MAX_CHROMATIC_ABERRATION,
  MAX_LEVELS_GAMMA,
  MAX_SHARPEN,
  MAX_PIXELATE,
  MAX_BLUR_FILL_SCALE,
} from '~/utils/video-editor/compositor/effect-render-ceilings';

const log = createDevLogger('WebGpuComputeRunner');

const UNIFORM_SIZE = 48; // 12 * 4 bytes
const TRANSITION_UNIFORM_SIZE = 64;

export interface EffectUniform {
  mode: number;
  width: number;
  height: number;
  seed: number;
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
}

/**
 * Logical buffer slot a pass reads from / writes to — mirror of the Rust `Buf`
 * enum. Explicit routing (instead of an implicit ping-pong) lets multi-pass
 * effects like bloom pin the running image while their internal passes
 * ping-pong, so compose blends glow over the current image (post earlier
 * effects), not the pristine source frame.
 */
export type Buf = 'input' | 'ping' | 'pong' | 'aux' | 'owned';

export interface ComputePass {
  uniform: EffectUniform;
  customSource?: string;
  src: Buf;
  secondary: Buf;
  dst: Buf;
}

export interface ApplyEffectsOptions {
  enablePadding?: boolean;
}

interface WebGpuTextureSystem {
  getGpuSource: (source: unknown) => GPUTexture;
}

interface WebGpuRendererLike {
  gpu?: { device?: GPUDevice };
  texture?: WebGpuTextureSystem;
}

interface BlurContentRect {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

interface BuildPassOptions {
  spatialScaleHeight?: number;
  contentRect?: BlurContentRect;
}

function spatialScale(height: number): number {
  return Math.max(0.1, Math.min(8.0, height / 1080.0));
}

function uniform(mode: number, width: number, height: number, seed = 0): EffectUniform {
  return { mode, width, height, seed, p0: 0, p1: 0, p2: 0, p3: 0, p4: 0, p5: 0, p6: 0, p7: 0 };
}

/** Pick a scratch buffer not in `avoid` (mirror of Rust `pick_scratch`). */
function pickScratch(avoid: Buf[]): Buf {
  for (const candidate of ['ping', 'pong', 'aux'] as Buf[]) {
    if (!avoid.includes(candidate)) return candidate;
  }
  return 'ping';
}

/** Separable gaussian or box blur, or single-pass radial blur; returns the buffer holding the result. */
function pushBlur(
  passes: ComputePass[],
  cur: Buf,
  radius: number,
  blurType: string,
  width: number,
  height: number,
  tapBudget: number,
  contentRect?: BlurContentRect,
  bleed = false,
): Buf {
  if (radius <= 0) return cur;
  // "Blur past edges" (bleed): run the blur in premultiplied-alpha space so the
  // content edge feathers softly OUTWARD with its real colour (transparent
  // padding contributes (0,0,0,0) → only the alpha composite darkens over black,
  // never the colour). Flagged per pass — mode 4 (H / radial) via p6, final V
  // (mode 14) via p2 (which also un-premultiplies). Routing is the plain
  // ping-pong (premult blur only reads its own input). See `effect.wgsl`.
  const bleedFlag = bleed ? 1.0 : 0.0;
  if (blurType === 'radial') {
    const t1 = pickScratch([cur]);
    const rect = contentRect ?? { offsetX: 0, offsetY: 0, width, height };
    passes.push({
      uniform: {
        ...uniform(4, width, height),
        p0: radius,
        p1: 2.0,
        p2: rect.offsetX / width,
        p3: rect.offsetY / height,
        p4: rect.width / width,
        p5: rect.height / height,
        p6: bleedFlag,
        p7: tapBudget,
      },
      src: cur,
      secondary: cur,
      dst: t1,
    });
    return t1;
  } else {
    const blurTypeVal = blurType === 'box' ? 1.0 : 0.0;
    const t1 = pickScratch([cur]);
    passes.push({
      uniform: {
        ...uniform(4, width, height),
        p0: radius,
        p1: blurTypeVal,
        p6: bleedFlag,
        p7: tapBudget,
      },
      src: cur,
      secondary: cur,
      dst: t1,
    });
    const t2 = pickScratch([t1]);
    passes.push({
      uniform: {
        ...uniform(14, width, height),
        p0: radius,
        p1: blurTypeVal,
        p2: bleedFlag,
        p7: tapBudget,
      },
      src: t1,
      secondary: t1,
      dst: t2,
    });
    return t2;
  }
}

/** Bloom: extract bright → blur → compose over the running image (`cur`). */
function pushBloom(
  passes: ComputePass[],
  cur: Buf,
  threshold: number,
  strength: number,
  radius: number,
  knee: number,
  width: number,
  height: number,
  tapBudget: number,
): Buf {
  if (radius <= 0) return cur;
  const base = cur;
  const a = pickScratch([base]);
  passes.push({
    uniform: { ...uniform(15, width, height), p0: threshold, p1: knee },
    src: base,
    secondary: base,
    dst: a,
  });
  const b = pickScratch([base, a]);
  passes.push({
    uniform: { ...uniform(4, width, height), p0: radius, p7: tapBudget },
    src: a,
    secondary: a,
    dst: b,
  });
  passes.push({
    uniform: { ...uniform(14, width, height), p0: radius, p7: tapBudget },
    src: b,
    secondary: b,
    dst: a,
  });
  // Compose: running image (base) + blurred glow (a) -> b.
  passes.push({
    uniform: { ...uniform(18, width, height), p1: strength },
    src: base,
    secondary: a,
    dst: b,
  });
  return b;
}

/** Post-effect mix pass: blends the effect result over the original image. */
function pushMix(
  passes: ComputePass[],
  effectResult: Buf,
  original: Buf,
  mix: number,
  width: number,
  height: number,
): Buf {
  const dst = pickScratch([effectResult, original]);
  passes.push({
    uniform: { ...uniform(19, width, height), p0: Math.max(0, Math.min(1.0, mix)) },
    src: effectResult,
    secondary: original,
    dst,
  });
  return dst;
}

/**
 * Builds the blur-fill pass chain (all at frame dims): cover-place the source
 * into a full-frame background plate, separably blur it, desaturate/dim/tint
 * the plate, then composite the contain-fit sharp foreground over it.
 * Mirror of Rust `build_blur_fill_passes`.
 */
export function buildBlurFillPasses(
  frameW: number,
  frameH: number,
  iw: number,
  ih: number,
  fgScale: number,
  bgScale: number,
  blur: number,
  bgDim: number,
  bgSaturation: number,
  tintColor: [number, number, number, number],
  tintStrength: number,
  fgOffsetY: number,
  quality: PreviewEffectQuality = 'ultra',
): ComputePass[] {
  const scale = spatialScale(frameH);
  const tapBudget = previewEffectQualityTapBudget(quality);
  const radius = Math.max(0, Math.min(MAX_BLUR_RADIUS, blur * scale));
  const iwf = iw;
  const ihf = ih;
  const passes: ComputePass[] = [];

  // Cover-place the source into the background plate (ping).
  passes.push({
    uniform: {
      ...uniform(20, frameW, frameH),
      p0: iwf,
      p1: ihf,
      p2: Math.max(0.01, Math.min(MAX_BLUR_FILL_SCALE, bgScale)),
    },
    src: 'input',
    secondary: 'input',
    dst: 'ping',
  });

  if (radius > 0) {
    passes.push({
      uniform: { ...uniform(4, frameW, frameH), p0: radius, p7: tapBudget },
      src: 'ping',
      secondary: 'ping',
      dst: 'pong',
    });
    passes.push({
      uniform: { ...uniform(14, frameW, frameH), p0: radius, p7: tapBudget },
      src: 'pong',
      secondary: 'pong',
      dst: 'ping',
    });
  }

  // Adjust the (blurred) plate: desaturate, dim, tint.
  passes.push({
    uniform: {
      ...uniform(22, frameW, frameH),
      p0: Math.max(0, Math.min(1.0, bgDim)),
      p1: Math.max(0, Math.min(2.0, bgSaturation)),
      p2: tintColor[0] / 255.0,
      p3: tintColor[1] / 255.0,
      p4: tintColor[2] / 255.0,
      p5: Math.max(0, Math.min(1.0, tintStrength)),
    },
    src: 'ping',
    secondary: 'ping',
    dst: 'pong',
  });

  // Composite the sharp foreground over the prepared background.
  passes.push({
    uniform: {
      ...uniform(21, frameW, frameH),
      p0: iwf,
      p1: ihf,
      p2: Math.max(0.01, Math.min(MAX_BLUR_FILL_SCALE, fgScale)),
      p3: Math.max(-0.5, Math.min(0.5, fgOffsetY)),
    },
    src: 'input',
    secondary: 'pong',
    dst: 'owned',
  });

  return passes;
}

export function buildPasses(
  effects: VideoEffectSpec[],
  width: number,
  height: number,
  quality: PreviewEffectQuality = 'ultra',
  options: BuildPassOptions = {},
): ComputePass[] {
  const scale = spatialScale(options.spatialScaleHeight ?? height);
  const tapBudget = previewEffectQualityTapBudget(quality);
  const passes: ComputePass[] = [];
  // Buffer currently holding the running image; effects chain off it.
  let cur: Buf = 'input';

  for (const effect of effects) {
    switch (effect.type) {
      case 'gaussian-blur': {
        const base = cur;
        cur = pushBlur(
          passes,
          cur,
          Math.max(0, Math.min(MAX_BLUR_RADIUS, effect.radius * scale)),
          effect.blur_type || 'gaussian',
          width,
          height,
          tapBudget,
          options.contentRect,
          effect.bleed === true,
        );
        if ((effect.mix ?? 1) < 1.0) {
          cur = pushMix(passes, cur, base, effect.mix ?? 1, width, height);
        }
        break;
      }
      case 'gaussian-blur-pixels': {
        const base = cur;
        cur = pushBlur(
          passes,
          cur,
          Math.max(0, Math.min(MAX_BLUR_RADIUS, effect.radius)),
          'gaussian',
          width,
          height,
          tapBudget,
          options.contentRect,
        );
        if ((effect.mix ?? 1) < 1.0) {
          cur = pushMix(passes, cur, base, effect.mix ?? 1, width, height);
        }
        break;
      }
      case 'bloom': {
        const base = cur;
        cur = pushBloom(
          passes,
          cur,
          Math.max(0, Math.min(1.0, effect.threshold)),
          Math.max(0, Math.min(MAX_BLOOM_STRENGTH, effect.strength)),
          Math.max(0, Math.min(MAX_BLOOM_RADIUS, effect.radius * scale)),
          Math.max(0, Math.min(1.0, effect.knee ?? 0.5)),
          width,
          height,
          tapBudget,
        );
        if ((effect.mix ?? 1) < 1.0) {
          cur = pushMix(passes, cur, base, effect.mix ?? 1, width, height);
        }
        break;
      }
      default: {
        // `blur-fill` reframes the layer to the project frame size and resets
        // the layer transform, so it can't be expressed as a plain in-place
        // chain pass. `effectUniform` returns null for it here, so this generic
        // chain skips it (no crash); both backends render it through a dedicated
        // path instead — web via `applyBlurFill` (`ClipResourceManager`) and
        // native via `apply_blur_fill`.
        const built = effectUniform(effect, width, height, scale);
        if (built) {
          const dst = pickScratch([cur]);
          passes.push({
            uniform: built.uniform,
            customSource: built.customSource,
            src: cur,
            secondary: cur,
            dst,
          });
          cur = dst;
        }
      }
    }
  }

  // The final result must land in the owned output texture.
  if (passes.length > 0) {
    passes[passes.length - 1]!.dst = 'owned';
  }
  return passes;
}

function effectUniform(
  effect: VideoEffectSpec,
  width: number,
  height: number,
  scale: number,
): { uniform: EffectUniform; customSource?: string } | null {
  const base = (
    mode: number,
    p0: number,
    p1: number,
    p2: number,
    p3: number,
    p4: number,
    p5: number,
    seed: number,
  ): { uniform: EffectUniform } => ({
    uniform: { mode, width, height, seed, p0, p1, p2, p3, p4, p5, p6: 0, p7: 0 },
  });

  switch (effect.type) {
    case 'brightness':
      return base(1, Math.max(0, Math.min(MAX_COLOR_MULTIPLIER, effect.value)), 0, 0, 0, 0, 0, 0);
    case 'contrast':
      return base(2, Math.max(0, Math.min(MAX_COLOR_MULTIPLIER, effect.value)), 0, 0, 0, 0, 0, 0);
    case 'saturation':
      return base(3, Math.max(0, Math.min(MAX_COLOR_MULTIPLIER, effect.value)), 0, 0, 0, 0, 0, 0);
    case 'gaussian-blur':
    case 'gaussian-blur-pixels':
    case 'bloom':
    case 'blur-fill':
      return null; // handled in buildPasses / applyBlurFill
    case 'sharpen':
      // Bidirectional: positive sharpens, negative softens.
      // p1 = sample step in px (resolution-normalized).
      return base(
        5,
        Math.max(-MAX_SHARPEN, Math.min(MAX_SHARPEN, effect.amount)),
        Math.max(1, scale),
        Math.max(0, Math.min(1.0, effect.mix ?? 1)),
        0,
        0,
        0,
        0,
      );
    case 'pixelate':
      return base(
        6,
        Math.max(1, Math.min(MAX_PIXELATE, effect.size * scale)),
        Math.max(0, Math.min(1.0, effect.mix ?? 1)),
        0,
        0,
        0,
        0,
        0,
      );
    case 'vignette':
      return base(
        8,
        Math.max(0, Math.min(1.0, effect.strength)),
        Math.max(0, Math.min(1.0, effect.radius)),
        Math.max(0.001, Math.min(1.0, effect.softness)),
        Math.max(0, Math.min(1.0, effect.mix ?? 1)),
        0,
        0,
        0,
      );
    case 'noise': {
      const typeVal =
        effect.noise_type === 'perlin' ? 1.0 : effect.noise_type === 'simplex' ? 2.0 : 0.0;
      const scaleVal = effect.scale || 10.0;
      return base(
        9,
        Math.max(0, Math.min(1.0, effect.amount)),
        typeVal,
        scaleVal,
        Math.max(0, Math.min(1.0, effect.mix ?? 1)),
        0,
        0,
        effect.seed,
      );
    }
    case 'chromatic-aberration':
      return base(
        10,
        Math.max(0, Math.min(MAX_CHROMATIC_ABERRATION, effect.amount * scale)),
        effect.angle_deg,
        Math.max(0, Math.min(1.0, effect.mix ?? 1)),
        0,
        0,
        0,
        0,
      );
    case 'color-tone': {
      const blendMode =
        effect.blend_mode === 'multiply'
          ? 1
          : effect.blend_mode === 'screen'
            ? 2
            : effect.blend_mode === 'overlay'
              ? 3
              : effect.blend_mode === 'soft-light'
                ? 4
                : 0;
      const range =
        effect.range === 'shadows'
          ? 1
          : effect.range === 'midtones'
            ? 2
            : effect.range === 'highlights'
              ? 3
              : 0;
      const built = base(
        23,
        effect.color_rgba[0] / 255.0,
        effect.color_rgba[1] / 255.0,
        effect.color_rgba[2] / 255.0,
        Math.max(0, Math.min(1.0, effect.amount)),
        blendMode,
        effect.preserve_luminance ? 1 : 0,
        0,
      );
      built.uniform.p6 = range;
      return built;
    }
    case 'hue':
      return base(11, effect.degrees, 0, 0, 0, 0, 0, 0);
    case 'levels':
      return base(
        12,
        Math.max(0, Math.min(1.0, effect.in_black)),
        Math.max(0.001, Math.min(1.0, effect.in_white)),
        Math.max(0.01, Math.min(MAX_LEVELS_GAMMA, effect.gamma)),
        Math.max(0, Math.min(1.0, effect.out_black)),
        Math.max(0, Math.min(1.0, effect.out_white)),
        Math.max(0, Math.min(1.0, effect.mix ?? 1)),
        0,
      );
    case 'chroma-key':
      return base(
        13,
        effect.key_rgba[0] / 255.0,
        effect.key_rgba[1] / 255.0,
        effect.key_rgba[2] / 255.0,
        Math.max(0, Math.min(1.0, effect.threshold)),
        Math.max(0.0001, Math.min(1.0, effect.smoothness)),
        0,
        0,
      );
    case 'custom-wgsl': {
      let p0 = 0,
        p1 = 0,
        p2 = 0,
        p3 = 0,
        p4 = 0,
        p5 = 0,
        p6 = 0,
        p7 = 0;
      if (typeof effect.params === 'object' && effect.params !== null) {
        const map = effect.params as Record<string, unknown>;
        const get = (k: string) => (typeof map[k] === 'number' ? (map[k] as number) : 0);
        p0 = get('p0');
        p1 = get('p1');
        p2 = get('p2');
        p3 = get('p3');
        p4 = get('p4');
        p5 = get('p5');
        p6 = get('p6');
        p7 = get('p7');
      }
      return {
        uniform: { mode: 0, width, height, seed: 0, p0, p1, p2, p3, p4, p5, p6, p7 },
        customSource: effect.source,
      };
    }
    default:
      return null;
  }
}

// Padding (in source px) the frame must grow by so blur can bleed past the
// original rectangle. Mirror of the Rust `calculate_padding`: only
// `gaussian-blur` effects that opted into `bleed` contribute — opaque-video
// blur, bloom and the internal pixel blur stay unpadded and clamp to the frame
// edges, so they never darken/fade the borders.
function calculatePadding(effects: VideoEffectSpec[], scale: number): number {
  let maxR = 0;
  for (const effect of effects) {
    if (effect.type === 'gaussian-blur' && effect.bleed) {
      const r = effect.radius * scale;
      if (r > maxR) maxR = r;
    }
  }
  return Math.ceil(maxR * 2.0);
}

export class WebGpuComputeRunner {
  private previewEffectQuality: PreviewEffectQuality = 'ultra';
  private device: GPUDevice | null = null;
  private ownsDevice = false;
  private sharedRendererTexture: WebGpuTextureSystem | null = null;
  private bindLayout: GPUBindGroupLayout | null = null;
  private pipeline: GPUComputePipeline | null = null;
  private shaderModule: GPUShaderModule | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private uniformCapacity = 0;
  private uniformStride = 0;

  private pingTexture: GPUTexture | null = null;
  private pongTexture: GPUTexture | null = null;
  private auxTexture: GPUTexture | null = null;
  private pingView: GPUTextureView | null = null;
  private pongView: GPUTextureView | null = null;
  private auxView: GPUTextureView | null = null;
  private ownedTexture: GPUTexture | null = null;
  private ownedView: GPUTextureView | null = null;
  private sampler: GPUSampler | null = null;
  private cachedWidth = 0;
  private cachedHeight = 0;

  // Cached input texture — reused across frames when the input size matches.
  // Previously allocated and destroyed on every runComputeChain call.
  private inputTexture: GPUTexture | null = null;
  private inputView: GPUTextureView | null = null;
  private inputCachedWidth = 0;
  private inputCachedHeight = 0;

  // Pooled MAP_READ staging buffer for the effect path (mirrors transReadbackBuffer).
  private effectReadbackBuffer: GPUBuffer | null = null;
  private effectReadbackCapacity = 0;

  // Reusable OffscreenCanvas for GPU→CPU readback in both effect and transition paths.
  private readbackCanvas: OffscreenCanvas | null = null;

  private customPipelines = new Map<string, GPUComputePipeline>();
  private transitionBindLayout: GPUBindGroupLayout | null = null;
  private transitionPipelines = new Map<string, GPUComputePipeline>();
  private static readonly MAX_CACHED_PIPELINES = 16;

  // Persistent transition resources, reused across frames. Allocating the
  // from/to/output textures + uniform buffer per call (the previous behaviour)
  // churned the GPU allocator every frame of every transition. They are
  // reallocated only when the frame size changes.
  private transFromTexture: GPUTexture | null = null;
  private transToTexture: GPUTexture | null = null;
  private transOutputTexture: GPUTexture | null = null;
  private transUniformBuffer: GPUBuffer | null = null;
  private transBindGroup: GPUBindGroup | null = null;
  private transCachedWidth = 0;
  private transCachedHeight = 0;
  // Pooled readback staging buffer for the transition output (MAP_READ).
  private transReadbackBuffer: GPUBuffer | null = null;
  private transReadbackCapacity = 0;

  private initializeDeviceResources(device: GPUDevice, options: { ownsDevice: boolean }): boolean {
    try {
      this.device = device;
      this.ownsDevice = options.ownsDevice;

      // Handle GPU device loss (driver crash, OOM, etc.) by tearing down all
      // cached resources so isReady() returns false and callers can re-init.
      this.device.lost.then((info) => {
        log.error('WebGPU device lost:', info?.reason, info?.message);
        this.handleDeviceLost();
      });

      this.bindLayout = this.device.createBindGroupLayout({
        label: 'web-effect-bind-layout',
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.COMPUTE,
            texture: { sampleType: 'float', viewDimension: '2d' },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.COMPUTE,
            storageTexture: { access: 'write-only', format: 'rgba8unorm', viewDimension: '2d' },
          },
          {
            binding: 2,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: UNIFORM_SIZE },
          },
          {
            binding: 3,
            visibility: GPUShaderStage.COMPUTE,
            texture: { sampleType: 'float', viewDimension: '2d' },
          },
          {
            binding: 4,
            visibility: GPUShaderStage.COMPUTE,
            sampler: { type: 'filtering' },
          },
        ],
      });
      this.transitionBindLayout = this.device.createBindGroupLayout({
        label: 'web-transition-bind-layout',
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.COMPUTE,
            texture: { sampleType: 'float', viewDimension: '2d' },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.COMPUTE,
            texture: { sampleType: 'float', viewDimension: '2d' },
          },
          {
            binding: 2,
            visibility: GPUShaderStage.COMPUTE,
            storageTexture: { access: 'write-only', format: 'rgba8unorm', viewDimension: '2d' },
          },
          {
            binding: 3,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: 'uniform', minBindingSize: TRANSITION_UNIFORM_SIZE },
          },
        ],
      });

      // Linear, clamp-to-edge sampler for sub-texel sampling (blur / sharpen /
      // chromatic aberration) — keeps those effects continuous in their params.
      this.sampler = this.device.createSampler({
        label: 'web-effect-sampler',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
        addressModeW: 'clamp-to-edge',
        magFilter: 'linear',
        minFilter: 'linear',
        mipmapFilter: 'linear',
      });

      this.shaderModule = this.device.createShaderModule({
        label: 'web-effect-shader',
        code: effectWgsl,
      });

      this.pipeline = this.device.createComputePipeline({
        label: 'web-effect-pipeline',
        layout: this.device.createPipelineLayout({
          bindGroupLayouts: [this.bindLayout],
        }),
        compute: {
          module: this.shaderModule,
          entryPoint: 'main',
        },
      });

      const align = this.device.limits.minUniformBufferOffsetAlignment;
      this.uniformStride = Math.ceil(UNIFORM_SIZE / align) * align;

      log.info('WebGpuComputeRunner initialized successfully.');
      return true;
    } catch (err) {
      log.error('Failed to initialize WebGPU device/pipeline:', err);
      if (options.ownsDevice) {
        try {
          device.destroy();
        } catch {
          // ignore
        }
      }
      this.handleDeviceLost();
      return false;
    }
  }

  public async init(): Promise<boolean> {
    if (this.device) return true;
    if (typeof navigator === 'undefined' || !navigator.gpu) {
      log.warn('WebGPU is not supported in this environment (navigator.gpu is undefined).');
      return false;
    }

    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        log.warn('Failed to request WebGPU adapter (requestAdapter returned null).');
        return false;
      }

      const device = await adapter.requestDevice();
      this.sharedRendererTexture = null;
      return this.initializeDeviceResources(device, { ownsDevice: true });
    } catch (err) {
      log.error('Failed to initialize WebGPU device:', err);
      return false;
    }
  }

  public initFromPixiRenderer(renderer: WebGpuRendererLike): boolean {
    const device = renderer.gpu?.device;
    const texture = renderer.texture ?? null;
    if (!device || !texture) {
      return this.isReady();
    }

    if (this.device === device) {
      this.sharedRendererTexture = texture;
      return this.isReady();
    }

    this.destroy();
    this.sharedRendererTexture = texture;
    return this.initializeDeviceResources(device, { ownsDevice: false });
  }

  public isReady(): boolean {
    return this.device !== null && this.pipeline !== null;
  }

  private executePasses(params: {
    inputView: GPUTextureView;
    passes: ComputePass[];
    outputWidth: number;
    outputHeight: number;
    label: string;
  }): GPUTexture | null {
    if (!this.device || !this.pipeline || !this.bindLayout || !this.shaderModule) {
      return null;
    }

    const { inputView, passes, outputWidth, outputHeight, label } = params;
    this.ensureTextures(outputWidth, outputHeight);
    this.ensureUniformBuffer(passes.length);

    const staging = new ArrayBuffer(this.uniformStride * passes.length);
    const u32 = new Uint32Array(staging);
    const f32 = new Float32Array(staging);

    for (let i = 0; i < passes.length; i++) {
      const base = (i * this.uniformStride) / 4;
      const u = passes[i]!.uniform;
      u32[base + 0] = u.mode;
      u32[base + 1] = u.width;
      u32[base + 2] = u.height;
      u32[base + 3] = u.seed;
      f32[base + 4] = u.p0;
      f32[base + 5] = u.p1;
      f32[base + 6] = u.p2;
      f32[base + 7] = u.p3;
      f32[base + 8] = u.p4;
      f32[base + 9] = u.p5;
      f32[base + 10] = u.p6;
      f32[base + 11] = u.p7;
    }

    this.device.queue.writeBuffer(this.uniformBuffer!, 0, staging);

    const encoder = this.device.createCommandEncoder({ label: `${label}-encoder` });

    const viewOf = (buf: Buf): GPUTextureView => {
      switch (buf) {
        case 'input':
          return inputView;
        case 'ping':
          return this.pingView!;
        case 'pong':
          return this.pongView!;
        case 'aux':
          return this.auxView!;
        case 'owned':
          return this.ownedView!;
      }
    };

    for (let index = 0; index < passes.length; index += 1) {
      const pass = passes[index]!;
      const uniformOffset = index * this.uniformStride;

      const bindSrc = viewOf(pass.src);
      const bindSecondary = viewOf(pass.secondary);
      const targetView = viewOf(pass.dst);

      let pipeline = this.pipeline;
      if (pass.customSource) {
        pipeline = this.getOrCreateCustomPipeline(pass.customSource);
      }

      const bindGroup = this.device.createBindGroup({
        label: `${label}-bind-group`,
        layout: this.bindLayout,
        entries: [
          { binding: 0, resource: bindSrc },
          { binding: 1, resource: targetView },
          {
            binding: 2,
            resource: { buffer: this.uniformBuffer!, offset: 0, size: UNIFORM_SIZE },
          },
          { binding: 3, resource: bindSecondary },
          { binding: 4, resource: this.sampler! },
        ],
      });

      const computePass = encoder.beginComputePass({ label: `${label}-pass` });
      computePass.setPipeline(pipeline);
      computePass.setBindGroup(0, bindGroup, [uniformOffset]);
      computePass.dispatchWorkgroups(Math.ceil(outputWidth / 8), Math.ceil(outputHeight / 8), 1);
      computePass.end();
    }

    this.device.queue.submit([encoder.finish()]);
    return this.ownedTexture;
  }

  /**
   * Normalises a decode source to an upload-ready bitmap and reports its
   * original dimensions. VideoFrame from WebCodecs may carry YUV pixel formats
   * that Chrome's copyExternalImageToTexture rejects, so we convert to
   * ImageBitmap first (always RGBA), matching the Rust side which uploads raw
   * RGBA bytes. The caller owns disposal via {@link runComputeChain}.
   */
  private async prepareUploadSource(source: VideoFrame | ImageBitmap): Promise<{
    uploadSource: ImageBitmap | VideoFrame;
    origW: number;
    origH: number;
  }> {
    let uploadSource: ImageBitmap | VideoFrame = source;
    if (source instanceof VideoFrame) {
      uploadSource = await createImageBitmap(source);
    }

    const origW = Math.max(
      1,
      Math.round(
        uploadSource instanceof VideoFrame
          ? Number(
              uploadSource.displayWidth ??
                (uploadSource as unknown as { codedWidth?: number }).codedWidth ??
                1,
            )
          : uploadSource.width,
      ),
    );
    const origH = Math.max(
      1,
      Math.round(
        uploadSource instanceof VideoFrame
          ? Number(
              uploadSource.displayHeight ??
                (uploadSource as unknown as { codedHeight?: number }).codedHeight ??
                1,
            )
          : uploadSource.height,
      ),
    );

    return { uploadSource, origW, origH };
  }

  /**
   * Shared GPU execution for the single-input compute paths (effects and
   * blur-fill): uploads the source into an input texture, runs the pass chain
   * into the pooled ping/pong/owned textures, and reads the owned output back
   * into an ImageBitmap. The two callers differ only in input/output sizes, the
   * copy origin (blur-fill writes at 0,0; effects insets by `padding`) and the
   * debug `label`. Disposes `uploadSource` after upload when it was created from
   * a VideoFrame.
   */
  private async runComputeChain(params: {
    source: VideoFrame | ImageBitmap;
    uploadSource: ImageBitmap | VideoFrame;
    passes: ComputePass[];
    inputWidth: number;
    inputHeight: number;
    copyOriginX: number;
    copyOriginY: number;
    copyWidth: number;
    copyHeight: number;
    outputWidth: number;
    outputHeight: number;
    label: string;
  }): Promise<ImageBitmap | null> {
    if (!this.device || !this.pipeline || !this.bindLayout || !this.shaderModule) {
      return null;
    }
    const {
      source,
      uploadSource,
      passes,
      inputWidth,
      inputHeight,
      copyOriginX,
      copyOriginY,
      copyWidth,
      copyHeight,
      outputWidth,
      outputHeight,
      label,
    } = params;

    this.ensureInputTexture(inputWidth, inputHeight);

    const inputTexture = this.inputTexture!;
    const inputView = this.inputView!;

    this.device.queue.copyExternalImageToTexture(
      { source: uploadSource, flipY: false },
      { texture: inputTexture, origin: { x: copyOriginX, y: copyOriginY, z: 0 } },
      { width: copyWidth, height: copyHeight, depthOrArrayLayers: 1 },
    );

    // Release the intermediate ImageBitmap immediately after upload to avoid
    // leaking GPU-backed bitmap memory.
    if (uploadSource !== source && 'close' in uploadSource) {
      (uploadSource as ImageBitmap).close();
    }

    const ownedTexture = this.executePasses({
      inputView,
      passes,
      outputWidth,
      outputHeight,
      label,
    });
    if (!ownedTexture) {
      return null;
    }

    // Read output back to CPU and create ImageBitmap
    const bytesPerRow = Math.ceil((outputWidth * 4) / 256) * 256;
    const needed = bytesPerRow * outputHeight;
    if (!this.effectReadbackBuffer || this.effectReadbackCapacity < needed) {
      this.effectReadbackBuffer?.destroy();
      this.effectReadbackBuffer = this.device.createBuffer({
        label: 'web-effect-readback',
        size: needed,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      this.effectReadbackCapacity = needed;
    }
    const outputBuffer = this.effectReadbackBuffer;

    const readEncoder = this.device.createCommandEncoder();
    readEncoder.copyTextureToBuffer(
      { texture: ownedTexture },
      { buffer: outputBuffer, bytesPerRow, rowsPerImage: outputHeight },
      { width: outputWidth, height: outputHeight, depthOrArrayLayers: 1 },
    );
    this.device.queue.submit([readEncoder.finish()]);

    await outputBuffer.mapAsync(GPUMapMode.READ, 0, needed);
    const mappedRange = outputBuffer.getMappedRange(0, needed);
    if (!this.readbackCanvas) {
      this.readbackCanvas = new OffscreenCanvas(outputWidth, outputHeight);
    } else {
      this.readbackCanvas.width = outputWidth;
      this.readbackCanvas.height = outputHeight;
    }
    const ctx = this.readbackCanvas.getContext('2d')!;
    const imageData = ctx.createImageData(outputWidth, outputHeight);
    const data = imageData.data;

    const rowSize = outputWidth * 4;
    if (bytesPerRow === rowSize) {
      data.set(new Uint8ClampedArray(mappedRange, 0, rowSize * outputHeight));
    } else {
      for (let y = 0; y < outputHeight; y++) {
        const srcOffset = y * bytesPerRow;
        const dstOffset = y * rowSize;
        data.set(new Uint8ClampedArray(mappedRange, srcOffset, rowSize), dstOffset);
      }
    }

    ctx.putImageData(imageData, 0, 0);
    outputBuffer.unmap();

    return await createImageBitmap(this.readbackCanvas);
  }

  public async applyBlurFill(params: {
    source: VideoFrame | ImageBitmap;
    frameW: number;
    frameH: number;
    fgScale: number;
    bgScale: number;
    blur: number;
    bgDim: number;
    bgSaturation: number;
    tintColor: [number, number, number, number];
    tintStrength: number;
    fgOffsetY: number;
  }): Promise<ImageBitmap | null> {
    const {
      source,
      frameW,
      frameH,
      fgScale,
      bgScale,
      blur,
      bgDim,
      bgSaturation,
      tintColor,
      tintStrength,
      fgOffsetY,
    } = params;
    if (!this.device || !this.pipeline || !this.bindLayout || !this.shaderModule) {
      return null;
    }

    const { uploadSource, origW, origH } = await this.prepareUploadSource(source);

    const passes = buildBlurFillPasses(
      frameW,
      frameH,
      origW,
      origH,
      fgScale,
      bgScale,
      blur,
      bgDim,
      bgSaturation,
      tintColor,
      tintStrength,
      fgOffsetY,
      this.previewEffectQuality,
    );
    if (passes.length === 0) return null;

    return this.runComputeChain({
      source,
      uploadSource,
      passes,
      inputWidth: origW,
      inputHeight: origH,
      copyOriginX: 0,
      copyOriginY: 0,
      copyWidth: origW,
      copyHeight: origH,
      outputWidth: frameW,
      outputHeight: frameH,
      label: 'web-blur-fill',
    });
  }

  public async applyEffects(
    source: VideoFrame | ImageBitmap,
    effects: VideoEffectSpec[],
    options: ApplyEffectsOptions = {},
  ): Promise<ImageBitmap | null> {
    if (!this.device || !this.pipeline || !this.bindLayout || !this.shaderModule) {
      return null;
    }
    if (effects.length === 0) return null;

    const { uploadSource, origW, origH } = await this.prepareUploadSource(source);

    const scale = Math.max(0.1, Math.min(8.0, origH / 1080.0));
    const padding = options.enablePadding === false ? 0 : calculatePadding(effects, scale);
    const w = origW + 2 * padding;
    const h = origH + 2 * padding;

    const passes = buildPasses(effects, w, h, this.previewEffectQuality, {
      spatialScaleHeight: origH,
      ...(padding > 0
        ? { contentRect: { offsetX: padding, offsetY: padding, width: origW, height: origH } }
        : {}),
    });
    if (passes.length === 0) return null;

    return this.runComputeChain({
      source,
      uploadSource,
      passes,
      inputWidth: w,
      inputHeight: h,
      copyOriginX: padding,
      copyOriginY: padding,
      copyWidth: origW,
      copyHeight: origH,
      outputWidth: w,
      outputHeight: h,
      label: 'web-effect',
    });
  }

  public applyEffectsToTexture(params: {
    source: RenderTexture;
    target: RenderTexture;
    effects: VideoEffectSpec[];
    options?: ApplyEffectsOptions;
  }): boolean {
    if (
      !this.device ||
      !this.pipeline ||
      !this.bindLayout ||
      !this.shaderModule ||
      !this.sharedRendererTexture
    ) {
      return false;
    }
    if (params.effects.length === 0) return false;

    const origW = Math.max(1, Math.round(params.source.source.pixelWidth));
    const origH = Math.max(1, Math.round(params.source.source.pixelHeight));
    if (
      params.source.source.format !== 'rgba8unorm' ||
      params.target.source.format !== 'rgba8unorm'
    ) {
      return false;
    }

    const scale = Math.max(0.1, Math.min(8.0, origH / 1080.0));
    const padding = params.options?.enablePadding === false ? 0 : calculatePadding(params.effects, scale);
    if (padding !== 0) {
      return false;
    }

    const passes = buildPasses(params.effects, origW, origH, this.previewEffectQuality, {
      spatialScaleHeight: origH,
    });
    if (passes.length === 0) return false;

    const sourceTexture = this.sharedRendererTexture.getGpuSource(params.source.source);
    const targetTexture = this.sharedRendererTexture.getGpuSource(params.target.source);
    const outputTexture = this.executePasses({
      inputView: sourceTexture.createView(),
      passes,
      outputWidth: origW,
      outputHeight: origH,
      label: 'web-effect-texture',
    });
    if (!outputTexture) {
      return false;
    }

    const encoder = this.device.createCommandEncoder({ label: 'web-effect-texture-copy' });
    encoder.copyTextureToTexture(
      { texture: outputTexture },
      { texture: targetTexture },
      { width: origW, height: origH, depthOrArrayLayers: 1 },
    );
    this.device.queue.submit([encoder.finish()]);
    return true;
  }

  public async applyTransition(params: {
    from: ImageBitmap;
    to: ImageBitmap;
    spec: TransitionSpec;
    progress: number;
    speed: number;
  }): Promise<ImageBitmap | null> {
    if (!this.device || !this.transitionBindLayout) return null;

    const width = Math.max(1, Math.round(params.to.width));
    const height = Math.max(1, Math.round(params.to.height));
    // Backend-parity contract: the web path requires both inputs to already be
    // the same size (the caller composites/scales them to the output frame
    // before this call) and runs the transition at that size. The native path
    // (`src-tauri/src/compositor/transitions/mod.rs`) instead receives raw
    // decoded frames at differing resolutions and blits each up to `max(from,
    // to)` internally — hence its blit shader has no web counterpart. The blend
    // math is identical because every transition shader samples with normalized
    // UVs; only the sampling resolution differs (benign).
    if (params.from.width !== width || params.from.height !== height) {
      throw new Error('Transition inputs must have identical dimensions.');
    }

    this.ensureTransitionResources(width, height);
    const fromTexture = this.transFromTexture!;
    const toTexture = this.transToTexture!;
    const outputTexture = this.transOutputTexture!;
    const uniformBuffer = this.transUniformBuffer!;

    {
      this.device.queue.copyExternalImageToTexture(
        { source: params.from },
        { texture: fromTexture },
        { width, height },
      );
      this.device.queue.copyExternalImageToTexture(
        { source: params.to },
        { texture: toTexture },
        { width, height },
      );

      const values = new ArrayBuffer(TRANSITION_UNIFORM_SIZE);
      const u32 = new Uint32Array(values);
      const f32 = new Float32Array(values);
      f32[0] = Math.max(0, Math.min(1, params.progress));
      u32[1] = width;
      u32[2] = height;
      f32[3] = Math.max(0, params.speed);
      const specParams =
        typeof params.spec.params === 'object' && params.spec.params !== null
          ? params.spec.params
          : {};
      for (let index = 0; index < 12; index += 1) {
        const value = (specParams as Record<string, unknown>)[`p${index}`];
        f32[4 + index] = typeof value === 'number' && Number.isFinite(value) ? value : 0;
      }
      if (params.spec.type === 'wipe') {
        f32[4] = typeof params.spec.angle_deg === 'number' ? params.spec.angle_deg : 0;
        f32[5] = typeof params.spec.softness === 'number' ? params.spec.softness : 0.1;
      } else if (params.spec.type === 'slide') {
        const dir = params.spec.direction;
        f32[4] = dir === 'left' ? 0.0 : dir === 'right' ? 1.0 : dir === 'up' ? 2.0 : 3.0;
      } else if (params.spec.type === 'fade-through-color') {
        const color = String(params.spec.color ?? '#000000')
          .trim()
          .replace(/^#/, '');
        const parsed = /^[0-9a-fA-F]{6}$/.test(color) ? Number.parseInt(color, 16) : 0;
        f32[4] = ((parsed >> 16) & 0xff) / 255;
        f32[5] = ((parsed >> 8) & 0xff) / 255;
        f32[6] = (parsed & 0xff) / 255;
      }
      this.device.queue.writeBuffer(uniformBuffer, 0, values);

      let source: string;
      if (params.spec.type === 'custom-wgsl' && typeof params.spec.source === 'string') {
        source = params.spec.source;
      } else if (params.spec.type === 'fade-through-color') {
        source = fadeThroughColorWgsl;
      } else if (params.spec.type === 'wipe') {
        source = wipeWgsl;
      } else if (params.spec.type === 'slide') {
        source = slideWgsl;
      } else {
        source = crossfadeWgsl;
      }
      const pipeline = this.getOrCreateTransitionPipeline(source);
      // The bind group only references the pooled textures + uniform buffer
      // (never the pipeline), so it stays valid until the frame size changes
      // and `ensureTransitionResources` rebuilds it.
      const bindGroup = this.transBindGroup!;
      const encoder = this.device.createCommandEncoder({ label: 'web-transition-encoder' });
      const pass = encoder.beginComputePass({ label: 'web-transition-pass' });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8), 1);
      pass.end();
      this.device.queue.submit([encoder.finish()]);

      return await this.readTextureToBitmap(outputTexture, width, height);
    }
  }

  public applyTransitionToTexture(params: {
    from: RenderTexture;
    to: RenderTexture;
    output: RenderTexture;
    spec: TransitionSpec;
    progress: number;
    speed: number;
  }): boolean {
    if (!this.device || !this.transitionBindLayout || !this.sharedRendererTexture) {
      return false;
    }

    const width = Math.max(1, Math.round(params.to.source.pixelWidth));
    const height = Math.max(1, Math.round(params.to.source.pixelHeight));
    if (
      params.from.source.format !== 'rgba8unorm' ||
      params.to.source.format !== 'rgba8unorm' ||
      params.output.source.format !== 'rgba8unorm'
    ) {
      return false;
    }

    if (params.from.source.pixelWidth !== width || params.from.source.pixelHeight !== height) {
      throw new Error('Transition inputs must have identical dimensions.');
    }

    this.ensureTransitionResources(width, height);
    const outputTexture = this.transOutputTexture!;
    const uniformBuffer = this.transUniformBuffer!;

    const values = new ArrayBuffer(TRANSITION_UNIFORM_SIZE);
    const u32 = new Uint32Array(values);
    const f32 = new Float32Array(values);
    f32[0] = Math.max(0, Math.min(1, params.progress));
    u32[1] = width;
    u32[2] = height;
    f32[3] = Math.max(0, params.speed);
    const specParams =
      typeof params.spec.params === 'object' && params.spec.params !== null ? params.spec.params : {};
    for (let index = 0; index < 12; index += 1) {
      const value = (specParams as Record<string, unknown>)[`p${index}`];
      f32[4 + index] = typeof value === 'number' && Number.isFinite(value) ? value : 0;
    }
    if (params.spec.type === 'wipe') {
      f32[4] = typeof params.spec.angle_deg === 'number' ? params.spec.angle_deg : 0;
      f32[5] = typeof params.spec.softness === 'number' ? params.spec.softness : 0.1;
    } else if (params.spec.type === 'slide') {
      const dir = params.spec.direction;
      f32[4] = dir === 'left' ? 0.0 : dir === 'right' ? 1.0 : dir === 'up' ? 2.0 : 3.0;
    } else if (params.spec.type === 'fade-through-color') {
      const color = String(params.spec.color ?? '#000000')
        .trim()
        .replace(/^#/, '');
      const parsed = /^[0-9a-fA-F]{6}$/.test(color) ? Number.parseInt(color, 16) : 0;
      f32[4] = ((parsed >> 16) & 0xff) / 255;
      f32[5] = ((parsed >> 8) & 0xff) / 255;
      f32[6] = (parsed & 0xff) / 255;
    }
    this.device.queue.writeBuffer(uniformBuffer, 0, values);

    let source: string;
    if (params.spec.type === 'custom-wgsl' && typeof params.spec.source === 'string') {
      source = params.spec.source;
    } else if (params.spec.type === 'fade-through-color') {
      source = fadeThroughColorWgsl;
    } else if (params.spec.type === 'wipe') {
      source = wipeWgsl;
    } else if (params.spec.type === 'slide') {
      source = slideWgsl;
    } else {
      source = crossfadeWgsl;
    }

    const bindGroup = this.device.createBindGroup({
      label: 'web-transition-texture-bind-group',
      layout: this.transitionBindLayout,
      entries: [
        {
          binding: 0,
          resource: this.sharedRendererTexture.getGpuSource(params.from.source).createView(),
        },
        {
          binding: 1,
          resource: this.sharedRendererTexture.getGpuSource(params.to.source).createView(),
        },
        { binding: 2, resource: outputTexture.createView() },
        { binding: 3, resource: { buffer: uniformBuffer } },
      ],
    });
    const pipeline = this.getOrCreateTransitionPipeline(source);
    const encoder = this.device.createCommandEncoder({ label: 'web-transition-texture-encoder' });
    const pass = encoder.beginComputePass({ label: 'web-transition-texture-pass' });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8), 1);
    pass.end();

    const targetTexture = this.sharedRendererTexture.getGpuSource(params.output.source);
    encoder.copyTextureToTexture(
      { texture: outputTexture },
      { texture: targetTexture },
      { width, height, depthOrArrayLayers: 1 },
    );
    this.device.queue.submit([encoder.finish()]);
    return true;
  }

  /**
   * Allocate (or reuse) the persistent from/to/output textures, uniform buffer
   * and bind group for the transition compute pass. Mirrors `ensureTextures`
   * for the effect path: everything is rebuilt only when the size changes.
   */
  private ensureTransitionResources(width: number, height: number): void {
    if (
      this.transFromTexture &&
      this.transCachedWidth === width &&
      this.transCachedHeight === height
    ) {
      return;
    }

    this.transFromTexture?.destroy();
    this.transToTexture?.destroy();
    this.transOutputTexture?.destroy();
    // The uniform buffer is size-independent, so allocate it once and keep it.

    const inputUsage =
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT;
    this.transFromTexture = this.device!.createTexture({
      label: 'web-transition-from',
      size: { width, height },
      format: 'rgba8unorm',
      usage: inputUsage,
    });
    this.transToTexture = this.device!.createTexture({
      label: 'web-transition-to',
      size: { width, height },
      format: 'rgba8unorm',
      usage: inputUsage,
    });
    this.transOutputTexture = this.device!.createTexture({
      label: 'web-transition-output',
      size: { width, height },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    if (!this.transUniformBuffer) {
      this.transUniformBuffer = this.device!.createBuffer({
        label: 'web-transition-uniform',
        size: TRANSITION_UNIFORM_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
    }

    this.transBindGroup = this.device!.createBindGroup({
      label: 'web-transition-bind-group',
      layout: this.transitionBindLayout!,
      entries: [
        { binding: 0, resource: this.transFromTexture.createView() },
        { binding: 1, resource: this.transToTexture.createView() },
        { binding: 2, resource: this.transOutputTexture.createView() },
        { binding: 3, resource: { buffer: this.transUniformBuffer } },
      ],
    });

    this.transCachedWidth = width;
    this.transCachedHeight = height;
  }

  public setPreviewEffectQuality(quality: PreviewEffectQuality): void {
    this.previewEffectQuality = quality;
  }

  private ensureTextures(width: number, height: number): void {
    // Scratch textures must match the logical size *exactly*: the blur samples
    // them with normalized UVs, which map [0,1] over the texture's full extent.
    // A cached texture that is merely "big enough" (e.g. left over at the padded
    // size after a `bleed` toggle) would make the sampler read the wrong region
    // and squish/duplicate the image. Mirror of the native `ensure_resources`.
    if (this.pingTexture && this.cachedWidth === width && this.cachedHeight === height) {
      return;
    }

    // Destroy previous scratch textures before reallocating at the new size.
    this.pingTexture?.destroy();
    this.pongTexture?.destroy();
    this.auxTexture?.destroy();

    const w = Math.max(1, width);
    const h = Math.max(1, height);
    const usage =
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.COPY_DST;

    this.pingTexture = this.device!.createTexture({
      label: 'web-effect-ping',
      size: { width: w, height: h, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage,
    });
    this.pingView = this.pingTexture.createView();

    this.pongTexture = this.device!.createTexture({
      label: 'web-effect-pong',
      size: { width: w, height: h, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage,
    });
    this.pongView = this.pongTexture.createView();

    // Third scratch buffer; used by bloom to pin the running image while
    // ping-ponging the bright-mask blur.
    this.auxTexture = this.device!.createTexture({
      label: 'web-effect-aux',
      size: { width: w, height: h, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage,
    });
    this.auxView = this.auxTexture.createView();

    // Owned output texture — same size as ping/pong/aux but without COPY_DST.
    this.ownedTexture?.destroy();
    this.ownedTexture = this.device!.createTexture({
      label: 'web-effect-owned',
      size: { width: w, height: h, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.COPY_SRC,
    });
    this.ownedView = this.ownedTexture.createView();

    this.cachedWidth = w;
    this.cachedHeight = h;
  }

  private ensureInputTexture(width: number, height: number): void {
    if (this.inputTexture && this.inputCachedWidth === width && this.inputCachedHeight === height) {
      return;
    }

    this.inputTexture?.destroy();

    const w = Math.max(1, width);
    const h = Math.max(1, height);
    this.inputTexture = this.device!.createTexture({
      label: 'web-effect-input',
      size: { width: w, height: h, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.inputView = this.inputTexture.createView();
    this.inputCachedWidth = w;
    this.inputCachedHeight = h;
  }

  private ensureUniformBuffer(passCount: number): void {
    const needed = this.uniformStride * Math.max(1, passCount);
    if (this.uniformBuffer && this.uniformCapacity >= needed) return;

    // Destroy the old buffer before allocating a larger one.
    this.uniformBuffer?.destroy();

    this.uniformBuffer = this.device!.createBuffer({
      label: 'web-effect-uniform-ring',
      size: needed,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.uniformCapacity = needed;
  }

  private getOrCreateCustomPipeline(source: string): GPUComputePipeline {
    const cached = this.customPipelines.get(source);
    if (cached) {
      // LRU touch: delete and re-insert to move to end (most recently used).
      this.customPipelines.delete(source);
      this.customPipelines.set(source, cached);
      return cached;
    }

    // Evict oldest pipeline when at capacity.
    if (this.customPipelines.size >= WebGpuComputeRunner.MAX_CACHED_PIPELINES) {
      const oldestKey = this.customPipelines.keys().next().value;
      if (typeof oldestKey === 'string') {
        this.customPipelines.delete(oldestKey);
      }
    }

    const customShader = this.device!.createShaderModule({
      label: 'web-effect-custom',
      code: source,
    });
    const customPipelineLayout = this.device!.createPipelineLayout({
      bindGroupLayouts: [this.bindLayout!],
    });
    const pipeline = this.device!.createComputePipeline({
      label: 'web-effect-custom-pipeline',
      layout: customPipelineLayout,
      compute: { module: customShader, entryPoint: 'main' },
    });
    this.customPipelines.set(source, pipeline);
    return pipeline;
  }

  private getOrCreateTransitionPipeline(source: string): GPUComputePipeline {
    const cached = this.transitionPipelines.get(source);
    if (cached) {
      // LRU touch: delete and re-insert to move to end (most recently used).
      this.transitionPipelines.delete(source);
      this.transitionPipelines.set(source, cached);
      return cached;
    }

    // Evict oldest pipeline when at capacity.
    if (this.transitionPipelines.size >= WebGpuComputeRunner.MAX_CACHED_PIPELINES) {
      const oldestKey = this.transitionPipelines.keys().next().value;
      if (typeof oldestKey === 'string') {
        this.transitionPipelines.delete(oldestKey);
      }
    }

    const pipeline = this.device!.createComputePipeline({
      label: 'web-transition-pipeline',
      layout: this.device!.createPipelineLayout({
        bindGroupLayouts: [this.transitionBindLayout!],
      }),
      compute: {
        module: this.device!.createShaderModule({
          label: 'web-transition-shader',
          code: source,
        }),
        entryPoint: 'main',
      },
    });
    this.transitionPipelines.set(source, pipeline);
    return pipeline;
  }

  private async readTextureToBitmap(
    texture: GPUTexture,
    width: number,
    height: number,
  ): Promise<ImageBitmap> {
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
    const needed = bytesPerRow * height;
    // Reuse a single MAP_READ staging buffer across frames. Calls are awaited
    // sequentially, so the buffer is always unmapped again before the next use;
    // it is only reallocated when a larger output appears.
    if (!this.transReadbackBuffer || this.transReadbackCapacity < needed) {
      this.transReadbackBuffer?.destroy();
      this.transReadbackBuffer = this.device!.createBuffer({
        label: 'web-transition-readback',
        size: needed,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      this.transReadbackCapacity = needed;
    }
    const outputBuffer = this.transReadbackBuffer;

    const encoder = this.device!.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture },
      { buffer: outputBuffer, bytesPerRow, rowsPerImage: height },
      { width, height },
    );
    this.device!.queue.submit([encoder.finish()]);
    await outputBuffer.mapAsync(GPUMapMode.READ, 0, needed);

    const mappedRange = outputBuffer.getMappedRange(0, needed);
    if (!this.readbackCanvas) {
      this.readbackCanvas = new OffscreenCanvas(width, height);
    } else {
      this.readbackCanvas.width = width;
      this.readbackCanvas.height = height;
    }
    const context = this.readbackCanvas.getContext('2d')!;
    const imageData = context.createImageData(width, height);
    const rowSize = width * 4;
    for (let y = 0; y < height; y += 1) {
      imageData.data.set(new Uint8ClampedArray(mappedRange, y * bytesPerRow, rowSize), y * rowSize);
    }
    context.putImageData(imageData, 0, 0);
    outputBuffer.unmap();
    return await createImageBitmap(this.readbackCanvas);
  }

  /**
   * Called when the GPU device is lost (driver crash, OOM, etc.). Releases all
   * cached resource references — the device itself is already gone, so we must
   * NOT call .destroy() on GPU objects (that would throw on a lost device).
   * After this, isReady() returns false and init() can be called again.
   */
  private handleDeviceLost(): void {
    this.pingTexture = null;
    this.pongTexture = null;
    this.auxTexture = null;
    this.pingView = null;
    this.pongView = null;
    this.auxView = null;
    this.ownedTexture = null;
    this.ownedView = null;
    this.inputTexture = null;
    this.inputView = null;
    this.inputCachedWidth = 0;
    this.inputCachedHeight = 0;
    this.effectReadbackBuffer = null;
    this.effectReadbackCapacity = 0;
    this.readbackCanvas = null;
    this.sampler = null;
    this.uniformBuffer = null;
    this.uniformCapacity = 0;
    this.transFromTexture = null;
    this.transToTexture = null;
    this.transOutputTexture = null;
    this.transUniformBuffer = null;
    this.transBindGroup = null;
    this.transReadbackBuffer = null;
    this.transReadbackCapacity = 0;
    this.transCachedWidth = 0;
    this.transCachedHeight = 0;
    this.cachedWidth = 0;
    this.cachedHeight = 0;
    this.customPipelines.clear();
    this.transitionPipelines.clear();
    this.transitionBindLayout = null;
    this.bindLayout = null;
    this.pipeline = null;
    this.shaderModule = null;
    this.device = null;
    this.ownsDevice = false;
    this.sharedRendererTexture = null;
  }

  /**
   * Release all persistent GPU resources. Call when the compositor is destroyed
   * to avoid leaking GPU memory across page navigations or compositor re-inits.
   */
  public destroy(): void {
    this.pingTexture?.destroy();
    this.pongTexture?.destroy();
    this.auxTexture?.destroy();
    this.ownedTexture?.destroy();
    this.inputTexture?.destroy();
    this.uniformBuffer?.destroy();
    this.effectReadbackBuffer?.destroy();
    this.transFromTexture?.destroy();
    this.transToTexture?.destroy();
    this.transOutputTexture?.destroy();
    this.transUniformBuffer?.destroy();
    this.transReadbackBuffer?.destroy();
    // GPUShaderModule has no .destroy(); releasing the owned device reclaims all
    // child objects (pipelines, shader modules, bind group layouts). A Pixi-owned
    // shared device must stay alive for the renderer.
    if (this.ownsDevice) {
      this.device?.destroy();
    }

    this.pingTexture = null;
    this.pongTexture = null;
    this.auxTexture = null;
    this.pingView = null;
    this.pongView = null;
    this.auxView = null;
    this.ownedTexture = null;
    this.ownedView = null;
    this.inputTexture = null;
    this.inputView = null;
    this.inputCachedWidth = 0;
    this.inputCachedHeight = 0;
    this.effectReadbackBuffer = null;
    this.effectReadbackCapacity = 0;
    this.readbackCanvas = null;
    this.sampler = null;
    this.uniformBuffer = null;
    this.uniformCapacity = 0;
    this.transFromTexture = null;
    this.transToTexture = null;
    this.transOutputTexture = null;
    this.transUniformBuffer = null;
    this.transBindGroup = null;
    this.transReadbackBuffer = null;
    this.transReadbackCapacity = 0;
    this.transCachedWidth = 0;
    this.transCachedHeight = 0;
    this.customPipelines.clear();
    this.transitionPipelines.clear();
    this.transitionBindLayout = null;
    this.bindLayout = null;
    this.pipeline = null;
    this.shaderModule = null;
    this.device = null;
    this.ownsDevice = false;
    this.sharedRendererTexture = null;
  }
}
