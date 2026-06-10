import type { VideoEffectSpec } from '~/types/generated/native-monitor/VideoEffectSpec';
import effectWgsl from '~shared/effects/effect.wgsl?raw';
import { createDevLogger } from '~/utils/dev-logger';

const log = createDevLogger('WebGpuComputeRunner');

const UNIFORM_SIZE = 48; // 12 * 4 bytes
const MAX_BLUR_RADIUS = 64.0;

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

export interface ComputePass {
  uniform: EffectUniform;
  customSource?: string;
}

function spatialScale(height: number): number {
  return Math.max(0.1, Math.min(8.0, height / 1080.0));
}

export function buildPasses(
  effects: VideoEffectSpec[],
  width: number,
  height: number,
): ComputePass[] {
  const scale = spatialScale(height);
  const passes: ComputePass[] = [];

  for (const effect of effects) {
    switch (effect.type) {
      case 'gaussian-blur': {
        const clampedR = Math.max(0, Math.min(MAX_BLUR_RADIUS, effect.radius * scale));
        if (clampedR > 0) {
          passes.push({
            uniform: {
              mode: 4,
              width,
              height,
              seed: 0,
              p0: clampedR,
              p1: 0,
              p2: 0,
              p3: 0,
              p4: 0,
              p5: 0,
              p6: 0,
              p7: 0,
            },
          });
          passes.push({
            uniform: {
              mode: 14,
              width,
              height,
              seed: 0,
              p0: clampedR,
              p1: 0,
              p2: 0,
              p3: 0,
              p4: 0,
              p5: 0,
              p6: 0,
              p7: 0,
            },
          });
        }
        break;
      }
      case 'gaussian-blur-pixels': {
        const clampedR = Math.max(0, Math.min(MAX_BLUR_RADIUS, effect.radius));
        if (clampedR > 0) {
          passes.push({
            uniform: {
              mode: 4,
              width,
              height,
              seed: 0,
              p0: clampedR,
              p1: 0,
              p2: 0,
              p3: 0,
              p4: 0,
              p5: 0,
              p6: 0,
              p7: 0,
            },
          });
          passes.push({
            uniform: {
              mode: 14,
              width,
              height,
              seed: 0,
              p0: clampedR,
              p1: 0,
              p2: 0,
              p3: 0,
              p4: 0,
              p5: 0,
              p6: 0,
              p7: 0,
            },
          });
        }
        break;
      }
      case 'bloom': {
        const clampedR = Math.max(0, Math.min(16.0, effect.radius * scale));
        if (clampedR > 0) {
          passes.push({
            uniform: {
              mode: 15,
              width,
              height,
              seed: 0,
              p0: Math.max(0, Math.min(1.0, effect.threshold)),
              p1: 0,
              p2: 0,
              p3: 0,
              p4: 0,
              p5: 0,
              p6: 0,
              p7: 0,
            },
          });
          passes.push({
            uniform: {
              mode: 4,
              width,
              height,
              seed: 0,
              p0: clampedR,
              p1: 0,
              p2: 0,
              p3: 0,
              p4: 0,
              p5: 0,
              p6: 0,
              p7: 0,
            },
          });
          passes.push({
            uniform: {
              mode: 14,
              width,
              height,
              seed: 0,
              p0: clampedR,
              p1: 0,
              p2: 0,
              p3: 0,
              p4: 0,
              p5: 0,
              p6: 0,
              p7: 0,
            },
          });
          passes.push({
            uniform: {
              mode: 18,
              width,
              height,
              seed: 0,
              p0: 0,
              p1: Math.max(0, Math.min(2.0, effect.strength)),
              p2: 0,
              p3: 0,
              p4: 0,
              p5: 0,
              p6: 0,
              p7: 0,
            },
          });
        }
        break;
      }
      default: {
        const pass = effectToPass(effect, width, height, scale);
        if (pass) passes.push(pass);
      }
    }
  }

  return passes;
}

function effectToPass(
  effect: VideoEffectSpec,
  width: number,
  height: number,
  scale: number,
): ComputePass | null {
  const base = (
    mode: number,
    p0: number,
    p1: number,
    p2: number,
    p3: number,
    p4: number,
    p5: number,
    seed: number,
  ): ComputePass => ({
    uniform: { mode, width, height, seed, p0, p1, p2, p3, p4, p5, p6: 0, p7: 0 },
  });

  switch (effect.type) {
    case 'brightness':
      return base(1, Math.max(0, Math.min(2.0, effect.value)), 0, 0, 0, 0, 0, 0);
    case 'contrast':
      return base(2, Math.max(0, Math.min(2.0, effect.value)), 0, 0, 0, 0, 0, 0);
    case 'saturation':
      return base(3, Math.max(0, Math.min(2.0, effect.value)), 0, 0, 0, 0, 0, 0);
    case 'gaussian-blur':
    case 'gaussian-blur-pixels':
    case 'bloom':
      return null; // handled in buildPasses
    case 'sharpen':
      return base(5, Math.max(0, Math.min(1.0, effect.amount)), 0, 0, 0, 0, 0, 0);
    case 'pixelate':
      return base(6, Math.max(1, Math.min(256, effect.size * scale)), 0, 0, 0, 0, 0, 0);
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
        Math.max(0, Math.min(80.0, effect.amount * scale)),
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
        Math.max(0.01, Math.min(8.0, effect.gamma)),
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
  private pingView: GPUTextureView | null = null;
  private pongView: GPUTextureView | null = null;
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
            texture: { sampleType: 'unfilterable-float', viewDimension: '2d' },
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
            texture: { sampleType: 'unfilterable-float', viewDimension: '2d' },
          },
        ],
      });

      this.shaderModule = this.device.createShaderModule({
        label: 'web-effect-wgsl',
        code: effectWgsl,
      });

      const pipelineLayout = this.device.createPipelineLayout({
        label: 'web-effect-pipeline-layout',
        bindGroupLayouts: [this.bindLayout],
      });

      this.pipeline = this.device.createComputePipeline({
        label: 'web-effect-pipeline',
        layout: pipelineLayout,
        compute: { module: this.shaderModule, entryPoint: 'main' },
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

    const w = Math.max(
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
    const h = Math.max(
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

    const passes = buildPasses(effects, w, h);
    if (passes.length === 0) return null;

    this.ensureTextures(w, h);

    const inputTexture = this.device.createTexture({
      label: 'web-effect-input',
      size: { width: w, height: h, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    try {
      this.device.queue.copyExternalImageToTexture(
        { source: uploadSource, flipY: false },
        { texture: inputTexture },
        { width: w, height: h, depthOrArrayLayers: 1 },
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
        const lastIndex = passes.length - 1;
        let lastIsPing = false;

        for (let index = 0; index < passes.length; index++) {
          const pass = passes[index]!;
          const uniformOffset = index * this.uniformStride;

          const sourceView = index === 0 ? inputView : lastIsPing ? this.pingView! : this.pongView!;
          const intermediateTarget = index === 0 || !lastIsPing ? this.pingView! : this.pongView!;
          const targetView = index === lastIndex ? owned.view : intermediateTarget;

          const isCompose = pass.uniform.mode === 18;
          const bindSrc = isCompose ? inputView : sourceView;
          const bindSecondary = isCompose ? sourceView : inputView;

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
            ],
          });

          const computePass = encoder.beginComputePass({ label: 'web-effect-pass' });
          computePass.setPipeline(pipeline);
          computePass.setBindGroup(0, bindGroup, [uniformOffset]);
          computePass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8), 1);
          computePass.end();

          lastIsPing = index === 0 || !lastIsPing;
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
    if (this.pingTexture && this.cachedWidth >= width && this.cachedHeight >= height) {
      return;
    }

    // Destroy previous ping/pong textures before reallocating at a larger size.
    this.pingTexture?.destroy();
    this.pongTexture?.destroy();

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
    this.uniformBuffer?.destroy();
    // GPUShaderModule has no .destroy(); releasing the device reclaims all
    // child objects (pipelines, shader modules, bind group layouts).
    this.device?.destroy();

    this.pingTexture = null;
    this.pongTexture = null;
    this.pingView = null;
    this.pongView = null;
    this.uniformBuffer = null;
    this.uniformCapacity = 0;
    this.customPipelines.clear();
    this.bindLayout = null;
    this.pipeline = null;
    this.shaderModule = null;
    this.device = null;
  }
}
