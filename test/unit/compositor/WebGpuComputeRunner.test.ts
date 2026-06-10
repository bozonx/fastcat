import { describe, it, expect, vi } from 'vitest';
import {
  buildPasses,
  WebGpuComputeRunner,
} from '~/utils/video-editor/compositor/WebGpuComputeRunner';
import type { VideoEffectSpec } from '~/types/generated/native-monitor/VideoEffectSpec';

describe('buildPasses', () => {
  it('includes custom-wgsl in pass chain', () => {
    const effects: VideoEffectSpec[] = [
      { type: 'brightness', value: 1.2 },
      { type: 'custom-wgsl', source: 'x', params: {} },
    ];
    const passes = buildPasses(effects, 1920, 1080);
    expect(passes.length).toBe(2);
    expect(passes[0]!.uniform.mode).toBe(1);
    expect(passes[1]!.uniform.mode).toBe(0);
    expect(passes[1]!.customSource).toBe('x');
  });

  it('splits gaussian-blur into horizontal and vertical', () => {
    const effects: VideoEffectSpec[] = [{ type: 'gaussian-blur', radius: 10.0 }];
    const passes = buildPasses(effects, 1920, 1080);
    expect(passes.length).toBe(2);
    expect(passes[0]!.uniform.mode).toBe(4);
    expect(passes[1]!.uniform.mode).toBe(14);
    expect(passes[0]!.uniform.p0).toBeCloseTo(10.0, 5);
    expect(passes[1]!.uniform.p0).toBeCloseTo(10.0, 5);
  });

  it('keeps gaussian-blur-pixels radius in texture pixels', () => {
    const effects: VideoEffectSpec[] = [{ type: 'gaussian-blur-pixels', radius: 10.0 }];
    const passes = buildPasses(effects, 1920, 540);
    expect(passes.length).toBe(2);
    expect(passes[0]!.uniform.mode).toBe(4);
    expect(passes[1]!.uniform.mode).toBe(14);
    expect(passes[0]!.uniform.p0).toBe(10.0);
    expect(passes[1]!.uniform.p0).toBe(10.0);
  });

  it('builds bloom as extract + blur_h + blur_v + compose', () => {
    const effects: VideoEffectSpec[] = [
      { type: 'bloom', threshold: 0.75, strength: 0.6, radius: 12.0 },
    ];
    const passes = buildPasses(effects, 1920, 1080);
    expect(passes.length).toBe(4);
    expect(passes[0]!.uniform.mode).toBe(15);
    expect(passes[1]!.uniform.mode).toBe(4);
    expect(passes[2]!.uniform.mode).toBe(14);
    expect(passes[3]!.uniform.mode).toBe(18);
    expect(passes[3]!.uniform.p1).toBeCloseTo(0.6, 5);
  });

  it('scales spatial params by frame height', () => {
    const effects: VideoEffectSpec[] = [{ type: 'gaussian-blur', radius: 10.0 }];
    const passes540 = buildPasses(effects, 1920, 540);
    const passes1080 = buildPasses(effects, 1920, 1080);
    // 540p blur radius should be half of 1080p
    expect(passes540[0]!.uniform.p0).toBeCloseTo(passes1080[0]!.uniform.p0 * 0.5, 5);
  });

  it('returns empty for disabled effects', () => {
    expect(buildPasses([], 1920, 1080)).toEqual([]);
  });

  it('clamps blur radius to MAX_BLUR_RADIUS', () => {
    const effects: VideoEffectSpec[] = [{ type: 'gaussian-blur', radius: 200.0 }];
    const passes = buildPasses(effects, 1920, 1080);
    expect(passes[0]!.uniform.p0).toBe(MAX_BLUR_RADIUS);
  });
});

const MAX_BLUR_RADIUS = 64.0;

describe('WebGpuComputeRunner', () => {
  it('reports not ready when WebGPU is unavailable', async () => {
    const runner = new WebGpuComputeRunner();
    expect(runner.isReady()).toBe(false);

    const originalGpu = (globalThis as unknown as Record<string, unknown>).navigator;
    vi.stubGlobal('navigator', { gpu: undefined });
    const result = await runner.init();
    expect(result).toBe(false);
    expect(runner.isReady()).toBe(false);
    vi.stubGlobal('navigator', originalGpu);
  });

  it('returns null from applyEffects when not initialized', async () => {
    const runner = new WebGpuComputeRunner();
    const fakeFrame = {
      displayWidth: 2,
      displayHeight: 2,
      codedWidth: 2,
      codedHeight: 2,
    } as unknown as VideoFrame;
    const result = await runner.applyEffects(fakeFrame, [{ type: 'brightness', value: 1.2 }]);
    expect(result).toBeNull();
  });

  it('destroy() is a safe no-op on an uninitialized runner', () => {
    const runner = new WebGpuComputeRunner();
    expect(() => runner.destroy()).not.toThrow();
    expect(runner.isReady()).toBe(false);
  });

  it('converts VideoFrame to ImageBitmap before copyExternalImageToTexture and disposes it', async () => {
    const runner = new WebGpuComputeRunner();

    const mockClose = vi.fn();
    const mockBitmap = {
      width: 4,
      height: 4,
      close: mockClose,
    } as unknown as ImageBitmap;

    const mockCopyExternalImageToTexture = vi.fn();
    const mockMapAsync = vi.fn().mockResolvedValue(undefined);
    // bytesPerRow is aligned to 256, so for a 4x4 frame we need 256*4 = 1024 bytes.
    const mockGetMappedRange = vi.fn().mockReturnValue(new ArrayBuffer(1024));

    const mockDevice = {
      createShaderModule: vi.fn().mockReturnValue({}),
      createBindGroupLayout: vi.fn().mockReturnValue({}),
      createPipelineLayout: vi.fn().mockReturnValue({}),
      createComputePipeline: vi.fn().mockReturnValue({}),
      limits: { minUniformBufferOffsetAlignment: 256 },
      createBuffer: vi.fn().mockReturnValue({
        destroy: vi.fn(),
        mapAsync: mockMapAsync,
        getMappedRange: mockGetMappedRange,
        unmap: vi.fn(),
      }),
      createTexture: vi.fn().mockReturnValue({
        createView: vi.fn().mockReturnValue({}),
        destroy: vi.fn(),
      }),
      createBindGroup: vi.fn().mockReturnValue({}),
      createCommandEncoder: vi.fn().mockReturnValue({
        beginComputePass: vi.fn().mockReturnValue({
          setPipeline: vi.fn(),
          setBindGroup: vi.fn(),
          dispatchWorkgroups: vi.fn(),
          end: vi.fn(),
        }),
        copyTextureToBuffer: vi.fn(),
        finish: vi.fn().mockReturnValue({}),
      }),
      queue: {
        copyExternalImageToTexture: mockCopyExternalImageToTexture,
        writeBuffer: vi.fn(),
        submit: vi.fn(),
      },
    } as any;

    const mockAdapter = {
      requestDevice: vi.fn().mockResolvedValue(mockDevice),
    } as any;

    vi.stubGlobal('navigator', {
      gpu: { requestAdapter: vi.fn().mockResolvedValue(mockAdapter) },
    });
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(mockBitmap));
    vi.stubGlobal('GPUShaderStage', { COMPUTE: 4 });
    vi.stubGlobal('VideoFrame', class VideoFrame {});
    vi.stubGlobal('GPUTextureUsage', {
      TEXTURE_BINDING: 4,
      STORAGE_BINDING: 8,
      COPY_SRC: 16,
      COPY_DST: 32,
      RENDER_ATTACHMENT: 64,
    });
    vi.stubGlobal('GPUBufferUsage', {
      COPY_DST: 8,
      MAP_READ: 1,
      UNIFORM: 64,
      COPY_SRC: 4,
    });
    vi.stubGlobal('GPUMapMode', { READ: 1 });
    vi.stubGlobal(
      'OffscreenCanvas',
      class OffscreenCanvas {
        width: number;
        height: number;
        constructor(w: number, h: number) {
          this.width = w;
          this.height = h;
        }
        getContext() {
          return {
            createImageData: () => ({ data: new Uint8ClampedArray(this.width * this.height * 4) }),
            putImageData: vi.fn(),
          };
        }
      },
    );

    await runner.init();

    // Must be a real instance of the mocked VideoFrame so instanceof works.
    const FakeVideoFrame = (globalThis as unknown as { VideoFrame: new () => object }).VideoFrame;
    const fakeFrame = new FakeVideoFrame() as unknown as VideoFrame;

    await runner.applyEffects(fakeFrame, [{ type: 'brightness', value: 1.2 }]);

    expect(createImageBitmap).toHaveBeenCalledWith(fakeFrame);
    expect(mockCopyExternalImageToTexture).toHaveBeenCalled();
    const copyArgs = mockCopyExternalImageToTexture.mock.calls[0];
    expect(copyArgs[0].source).toBe(mockBitmap);
    expect(mockClose).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('catches initialization errors gracefully and returns false', async () => {
    const runner = new WebGpuComputeRunner();

    const mockAdapter = {
      requestDevice: vi.fn().mockRejectedValue(new Error('GPUDevice creation failed')),
    } as any;

    vi.stubGlobal('navigator', {
      gpu: { requestAdapter: vi.fn().mockResolvedValue(mockAdapter) },
    });

    const result = await runner.init();
    expect(result).toBe(false);
    expect(runner.isReady()).toBe(false);

    vi.unstubAllGlobals();
  });
});
