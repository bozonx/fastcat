import type { VideoEffectSpec } from '~/types/generated/native-monitor/VideoEffectSpec';
import type { TransitionSpec } from '~/transitions';
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

const log = createDevLogger('WebGpuComputeRunner');

const UNIFORM_SIZE = 48; // 12 * 4 bytes
const TRANSITION_UNIFORM_SIZE = 64;
// Hard render ceilings — must stay byte-identical to the Rust side
// (`src-tauri/src/compositor/effects/mod.rs`). These bound every value reaching
// the GPU and are the ceiling an animation key can reach; the frontend
// `renderMin/renderMax` in `video-manifests.ts` mirror them.
const MAX_BLUR_RADIUS = 1024.0;
const MAX_BLOOM_RADIUS = 512.0;
const MAX_COLOR_MULTIPLIER = 4.0;
const MAX_BLOOM_STRENGTH = 4.0;
const MAX_CHROMATIC_ABERRATION = 256.0;
const MAX_LEVELS_GAMMA = 16.0;
const MAX_SHARPEN = 4.0;
const MAX_PIXELATE = 256.0;
const MAX_BLUR_FILL_SCALE = 8.0;

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
): Buf {
  if (radius <= 0) return cur;
  if (blurType === 'radial') {
    const t1 = pickScratch([cur]);
    passes.push({
      uniform: { ...uniform(4, width, height), p0: radius, p1: 2.0, p7: tapBudget },
      src: cur,
      secondary: cur,
      dst: t1,
    });
    return t1;
  } else {
    const blurTypeVal = blurType === 'box' ? 1.0 : 0.0;
    const t1 = pickScratch([cur]);
    passes.push({
      uniform: { ...uniform(4, width, height), p0: radius, p1: blurTypeVal, p7: tapBudget },
      src: cur,
      secondary: cur,
      dst: t1,
    });
    const t2 = pickScratch([t1]);
    passes.push({
      uniform: { ...uniform(14, width, height), p0: radius, p1: blurTypeVal, p7: tapBudget },
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
): ComputePass[] {
  const scale = spatialScale(height);
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
  private sampler: GPUSampler | null = null;
  private cachedWidth = 0;
  private cachedHeight = 0;

  private customPipelines = new Map<string, GPUComputePipeline>();
  private transitionBindLayout: GPUBindGroupLayout | null = null;
  private transitionPipelines = new Map<string, GPUComputePipeline>();

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

      this.device = await adapter.requestDevice();

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
      return false;
    }
  }

  public isReady(): boolean {
    return this.device !== null && this.pipeline !== null;
  }

  public async applyBlurFill(
    source: VideoFrame | ImageBitmap,
    frameW: number,
    frameH: number,
    fgScale: number,
    bgScale: number,
    blur: number,
    bgDim: number,
    bgSaturation: number,
    tintColor: [number, number, number, number],
    tintStrength: number,
    fgOffsetY: number,
  ): Promise<ImageBitmap | null> {
    if (!this.device || !this.pipeline || !this.bindLayout || !this.shaderModule) {
      return null;
    }

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

    this.ensureTextures(frameW, frameH);

    const inputTexture = this.device.createTexture({
      label: 'web-blur-fill-input',
      size: { width: origW, height: origH, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });

    try {
      this.device.queue.copyExternalImageToTexture(
        { source: uploadSource, flipY: false },
        { texture: inputTexture, origin: { x: 0, y: 0, z: 0 } },
        { width: origW, height: origH, depthOrArrayLayers: 1 },
      );

      if (uploadSource !== source && 'close' in uploadSource) {
        (uploadSource as ImageBitmap).close();
      }

      const inputView = inputTexture.createView();
      const owned = this.createOutputTexture(frameW, frameH);

      try {
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

        const encoder = this.device.createCommandEncoder({ label: 'web-blur-fill-encoder' });

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
              return owned.view;
          }
        };

        for (let index = 0; index < passes.length; index++) {
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
            label: 'web-blur-fill-bind-group',
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

          const computePass = encoder.beginComputePass({ label: 'web-blur-fill-pass' });
          computePass.setPipeline(pipeline);
          computePass.setBindGroup(0, bindGroup, [uniformOffset]);
          computePass.dispatchWorkgroups(Math.ceil(frameW / 8), Math.ceil(frameH / 8), 1);
          computePass.end();
        }

        this.device.queue.submit([encoder.finish()]);

        const bytesPerRow = Math.ceil((frameW * 4) / 256) * 256;
        const outputBuffer = this.device.createBuffer({
          size: bytesPerRow * frameH,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });

        try {
          const readEncoder = this.device.createCommandEncoder();
          readEncoder.copyTextureToBuffer(
            { texture: owned.texture },
            { buffer: outputBuffer, bytesPerRow, rowsPerImage: frameH },
            { width: frameW, height: frameH, depthOrArrayLayers: 1 },
          );
          this.device.queue.submit([readEncoder.finish()]);

          await outputBuffer.mapAsync(GPUMapMode.READ);
          const mappedRange = outputBuffer.getMappedRange();
          const canvas = new OffscreenCanvas(frameW, frameH);
          const ctx = canvas.getContext('2d')!;
          const imageData = ctx.createImageData(frameW, frameH);
          const data = imageData.data;

          const rowSize = frameW * 4;
          if (bytesPerRow === rowSize) {
            data.set(new Uint8ClampedArray(mappedRange, 0, rowSize * frameH));
          } else {
            for (let y = 0; y < frameH; y++) {
              const srcOffset = y * bytesPerRow;
              const dstOffset = y * rowSize;
              data.set(new Uint8ClampedArray(mappedRange, srcOffset, rowSize), dstOffset);
            }
          }

          ctx.putImageData(imageData, 0, 0);
          outputBuffer.unmap();

          return await createImageBitmap(canvas);
        } finally {
          outputBuffer.destroy();
        }
      } finally {
        owned.texture.destroy();
      }
    } finally {
      inputTexture.destroy();
    }
  }

  public async applyEffects(
    source: VideoFrame | ImageBitmap,
    effects: VideoEffectSpec[],
  ): Promise<ImageBitmap | null> {
    if (!this.device || !this.pipeline || !this.bindLayout || !this.shaderModule) {
      return null;
    }
    if (effects.length === 0) return null;

    // VideoFrame from WebCodecs may carry YUV pixel formats that Chrome's
    // copyExternalImageToTexture rejects. Convert to ImageBitmap first so the
    // upload path is always RGBA and matches the Rust side (which uploads raw
    // RGBA bytes via queue.write_texture).
    let uploadSource: ImageBitmap | VideoFrame = source;
    if (source instanceof VideoFrame) {
      uploadSource = await createImageBitmap(source);
    }

    let w = Math.max(
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
    let h = Math.max(
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

    const origW = w;
    const origH = h;
    const scale = Math.max(0.1, Math.min(8.0, origH / 1080.0));
    const padding = calculatePadding(effects, scale);
    w = origW + 2 * padding;
    h = origH + 2 * padding;

    const passes = buildPasses(effects, w, h, this.previewEffectQuality);
    if (passes.length === 0) return null;

    this.ensureTextures(w, h);

    const inputTexture = this.device.createTexture({
      label: 'web-effect-input',
      size: { width: w, height: h, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });

    try {
      this.device.queue.copyExternalImageToTexture(
        { source: uploadSource, flipY: false },
        { texture: inputTexture, origin: { x: padding, y: padding, z: 0 } },
        { width: origW, height: origH, depthOrArrayLayers: 1 },
      );

      // Release the intermediate ImageBitmap immediately after upload to avoid
      // leaking GPU-backed bitmap memory.
      if (uploadSource !== source && 'close' in uploadSource) {
        (uploadSource as ImageBitmap).close();
      }

      const inputView = inputTexture.createView();
      const owned = this.createOutputTexture(w, h);

      try {
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

        const encoder = this.device.createCommandEncoder({ label: 'web-effect-encoder' });

        // Map a logical buffer slot to its concrete view (mirror of the Rust
        // `view_of` routing). The final pass is routed to `owned` by buildPasses.
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
              return owned.view;
          }
        };

        for (let index = 0; index < passes.length; index++) {
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
            label: 'web-effect-bind-group',
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

          const computePass = encoder.beginComputePass({ label: 'web-effect-pass' });
          computePass.setPipeline(pipeline);
          computePass.setBindGroup(0, bindGroup, [uniformOffset]);
          computePass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8), 1);
          computePass.end();
        }

        this.device.queue.submit([encoder.finish()]);

        // Read output back to CPU and create ImageBitmap
        const bytesPerRow = Math.ceil((w * 4) / 256) * 256;
        const outputBuffer = this.device.createBuffer({
          size: bytesPerRow * h,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });

        try {
          const readEncoder = this.device.createCommandEncoder();
          readEncoder.copyTextureToBuffer(
            { texture: owned.texture },
            { buffer: outputBuffer, bytesPerRow, rowsPerImage: h },
            { width: w, height: h, depthOrArrayLayers: 1 },
          );
          this.device.queue.submit([readEncoder.finish()]);

          await outputBuffer.mapAsync(GPUMapMode.READ);
          const mappedRange = outputBuffer.getMappedRange();
          const canvas = new OffscreenCanvas(w, h);
          const ctx = canvas.getContext('2d')!;
          const imageData = ctx.createImageData(w, h);
          const data = imageData.data;

          const rowSize = w * 4;
          if (bytesPerRow === rowSize) {
            data.set(new Uint8ClampedArray(mappedRange, 0, rowSize * h));
          } else {
            for (let y = 0; y < h; y++) {
              const srcOffset = y * bytesPerRow;
              const dstOffset = y * rowSize;
              data.set(new Uint8ClampedArray(mappedRange, srcOffset, rowSize), dstOffset);
            }
          }

          ctx.putImageData(imageData, 0, 0);
          outputBuffer.unmap();

          const result = await createImageBitmap(canvas);
          return result;
        } finally {
          outputBuffer.destroy();
        }
      } finally {
        owned.texture.destroy();
      }
    } finally {
      inputTexture.destroy();
    }
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

    this.cachedWidth = w;
    this.cachedHeight = h;
  }

  private createOutputTexture(
    width: number,
    height: number,
  ): { texture: GPUTexture; view: GPUTextureView } {
    const texture = this.device!.createTexture({
      label: 'web-effect-output',
      size: { width, height, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.COPY_SRC,
    });
    return { texture, view: texture.createView() };
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
    if (this.customPipelines.has(source)) {
      return this.customPipelines.get(source)!;
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
    if (cached) return cached;

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
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d')!;
    const imageData = context.createImageData(width, height);
    const rowSize = width * 4;
    for (let y = 0; y < height; y += 1) {
      imageData.data.set(new Uint8ClampedArray(mappedRange, y * bytesPerRow, rowSize), y * rowSize);
    }
    context.putImageData(imageData, 0, 0);
    outputBuffer.unmap();
    return await createImageBitmap(canvas);
  }

  /**
   * Release all persistent GPU resources. Call when the compositor is destroyed
   * to avoid leaking GPU memory across page navigations or compositor re-inits.
   */
  public destroy(): void {
    this.pingTexture?.destroy();
    this.pongTexture?.destroy();
    this.auxTexture?.destroy();
    this.uniformBuffer?.destroy();
    this.transFromTexture?.destroy();
    this.transToTexture?.destroy();
    this.transOutputTexture?.destroy();
    this.transUniformBuffer?.destroy();
    this.transReadbackBuffer?.destroy();
    // GPUShaderModule has no .destroy(); releasing the device reclaims all
    // child objects (pipelines, shader modules, bind group layouts).
    this.device?.destroy();

    this.pingTexture = null;
    this.pongTexture = null;
    this.auxTexture = null;
    this.pingView = null;
    this.pongView = null;
    this.auxView = null;
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
  }
}
