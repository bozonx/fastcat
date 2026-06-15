import type { VideoEffectSpec } from '~/types/generated/native-monitor/VideoEffectSpec';
import effectWgsl from '~shared/effects/effect.wgsl?raw';
import { createDevLogger } from '~/utils/dev-logger';

const log = createDevLogger('WebGpuComputeRunner');

const UNIFORM_SIZE = 48; // 12 * 4 bytes
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

/** Separable gaussian blur (h then v); returns the buffer holding the result. */
function pushBlur(
  passes: ComputePass[],
  cur: Buf,
  radius: number,
  width: number,
  height: number,
): Buf {
  if (radius <= 0) return cur;
  const t1 = pickScratch([cur]);
  passes.push({
    uniform: { ...uniform(4, width, height), p0: radius },
    src: cur,
    secondary: cur,
    dst: t1,
  });
  const t2 = pickScratch([t1]);
  passes.push({
    uniform: { ...uniform(14, width, height), p0: radius },
    src: t1,
    secondary: t1,
    dst: t2,
  });
  return t2;
}

/** Bloom: extract bright → blur → compose over the running image (`cur`). */
function pushBloom(
  passes: ComputePass[],
  cur: Buf,
  threshold: number,
  strength: number,
  radius: number,
  width: number,
  height: number,
): Buf {
  if (radius <= 0) return cur;
  const base = cur;
  const a = pickScratch([base]);
  passes.push({
    uniform: { ...uniform(15, width, height), p0: threshold },
    src: base,
    secondary: base,
    dst: a,
  });
  const b = pickScratch([base, a]);
  passes.push({
    uniform: { ...uniform(4, width, height), p0: radius },
    src: a,
    secondary: a,
    dst: b,
  });
  passes.push({
    uniform: { ...uniform(14, width, height), p0: radius },
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

export function buildPasses(
  effects: VideoEffectSpec[],
  width: number,
  height: number,
): ComputePass[] {
  const scale = spatialScale(height);
  const passes: ComputePass[] = [];
  // Buffer currently holding the running image; effects chain off it.
  let cur: Buf = 'input';

  for (const effect of effects) {
    switch (effect.type) {
      case 'gaussian-blur':
        cur = pushBlur(
          passes,
          cur,
          Math.max(0, Math.min(MAX_BLUR_RADIUS, effect.radius * scale)),
          width,
          height,
        );
        break;
      case 'gaussian-blur-pixels':
        cur = pushBlur(
          passes,
          cur,
          Math.max(0, Math.min(MAX_BLUR_RADIUS, effect.radius)),
          width,
          height,
        );
        break;
      case 'bloom':
        cur = pushBloom(
          passes,
          cur,
          Math.max(0, Math.min(1.0, effect.threshold)),
          Math.max(0, Math.min(MAX_BLOOM_STRENGTH, effect.strength)),
          Math.max(0, Math.min(MAX_BLOOM_RADIUS, effect.radius * scale)),
          width,
          height,
        );
        break;
      default: {
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
      return null; // handled in buildPasses
    case 'sharpen':
      // Bidirectional: positive sharpens, negative softens.
      // p1 = sample step in px (resolution-normalized).
      return base(
        5,
        Math.max(-MAX_SHARPEN, Math.min(MAX_SHARPEN, effect.amount)),
        Math.max(1, scale),
        0,
        0,
        0,
        0,
        0,
      );
    case 'pixelate':
      return base(6, Math.max(1, Math.min(MAX_PIXELATE, effect.size * scale)), 0, 0, 0, 0, 0, 0);
    case 'vignette':
      return base(
        8,
        Math.max(0, Math.min(1.0, effect.strength)),
        Math.max(0, Math.min(1.0, effect.radius)),
        Math.max(0.001, Math.min(1.0, effect.softness)),
        0,
        0,
        0,
        0,
      );
    case 'noise':
      return base(9, Math.max(0, Math.min(1.0, effect.amount)), 0, 0, 0, 0, 0, effect.seed);
    case 'chromatic-aberration':
      return base(
        10,
        Math.max(0, Math.min(MAX_CHROMATIC_ABERRATION, effect.amount * scale)),
        effect.angle_deg,
        0,
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
        0,
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

    const passes = buildPasses(effects, w, h);
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

  /**
   * Release all persistent GPU resources. Call when the compositor is destroyed
   * to avoid leaking GPU memory across page navigations or compositor re-inits.
   */
  public destroy(): void {
    this.pingTexture?.destroy();
    this.pongTexture?.destroy();
    this.auxTexture?.destroy();
    this.uniformBuffer?.destroy();
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
    this.customPipelines.clear();
    this.bindLayout = null;
    this.pipeline = null;
    this.shaderModule = null;
    this.device = null;
  }
}
