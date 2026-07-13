import { BASE_VIDEO_CODEC_OPTIONS } from '~/utils/webcodecs';
import type { GpuCoverageSnapshot } from '~/utils/video-editor/compositor/CompositorPerfStats';

export interface VideoDiagnosticsProbeOptions {
  audioCodec: string;
  audioBitrate: number;
  audioChannels: number;
  audioSampleRate: number;
  height: number;
  videoBitrate: number;
  videoCodec: string;
  width: number;
  framerate: number;
}

export interface VideoDiagnosticsStatus {
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
}

export interface VideoDiagnosticsKeyValueItem {
  label: string;
  value: string;
}

export interface VideoDiagnosticsSection {
  description: string;
  items: VideoDiagnosticsKeyValueItem[];
  status: VideoDiagnosticsStatus;
  title: string;
}

export interface VideoDiagnosticsSnapshot {
  sections: VideoDiagnosticsSection[];
  summary: VideoDiagnosticsStatus;
}

interface BrowserLike {
  AudioEncoder?: {
    isConfigSupported?: (config: Record<string, unknown>) => Promise<{ supported?: boolean }>;
  };
  crossOriginIsolated?: boolean;
  isSecureContext?: boolean;
  VideoDecoder?: {
    isConfigSupported?: (config: Record<string, unknown>) => Promise<{ supported?: boolean }>;
  };
  OffscreenCanvas?: new (width: number, height: number) => OffscreenCanvas;
  VideoEncoder?: {
    isConfigSupported?: (config: Record<string, unknown>) => Promise<{ supported?: boolean }>;
  };
  createImageBitmap?: (image: Blob) => Promise<ImageBitmap>;
}

interface NavigatorLike {
  gpu?: {
    requestAdapter?: () => Promise<GPUAdapterLike | null>;
  };
  mediaCapabilities?: {
    encodingInfo?: (config: Record<string, unknown>) => Promise<MediaCapabilitiesInfoLike>;
  };
  userAgent?: string;
}

interface GPUAdapterLike {
  features?: Iterable<string>;
  info?: {
    architecture?: string;
    description?: string;
    device?: string;
    vendor?: string;
  };
  limits?: {
    maxTextureDimension2D?: number;
    maxBufferSize?: number;
  };
  requestDevice?: () => Promise<unknown>;
}

interface GPUDeviceLike {
  destroy?: () => void;
}

interface WebGpuInfo {
  adapterAvailable: boolean;
  adapterRequestError: string | null;
  adapterRequestStatus: string;
  apiAvailable: boolean;
  architecture: string | null;
  description: string | null;
  device: string | null;
  deviceAvailable: boolean;
  deviceRequestError: string | null;
  deviceRequestStatus: string;
  featureCount: number | null;
  maxBufferSize: number | null;
  maxTextureDimension2D: number | null;
  vendor: string | null;
}

interface MediaCapabilitiesInfoLike {
  powerEfficient?: boolean;
  smooth?: boolean;
  supported?: boolean;
}

interface WebGlRenderingContextLike {
  MAX_TEXTURE_SIZE?: number;
  MAX_RENDERBUFFER_SIZE?: number;
  RENDERER?: number;
  SHADING_LANGUAGE_VERSION?: number;
  VENDOR?: number;
  VERSION?: number;
  getExtension?: (
    name: string,
  ) => { UNMASKED_RENDERER_WEBGL?: number; UNMASKED_VENDOR_WEBGL?: number } | null;
  getParameter: (param: number) => unknown;
}

interface CanvasLike {
  getContext: (name: string) => unknown;
}

interface WebGlInfo {
  context: string | null;
  maxRenderbufferSize: number | null;
  maxTextureSize: number | null;
  renderer: string | null;
  shadingLanguageVersion: string | null;
  supported: boolean | null;
  vendor: string | null;
  version: string | null;
}

interface VideoCodecDiagnosticsResult {
  decodeSupported: boolean | null;
  hardwareEncodeSupported: boolean | null;
  label: string;
  softwareEncodeSupported: boolean | null;
  value: string;
}

interface GatherVideoDiagnosticsOptions {
  browser?: BrowserLike;
  createCanvas?: () => CanvasLike;
  navigatorObject?: NavigatorLike;
  probe: VideoDiagnosticsProbeOptions;
  checkWorkerWebGpu?: () => Promise<{ supported: boolean; error: string | null }>;
  getCompositorPerf?: () => Promise<GpuCoverageSnapshot | null>;
}

function formatBoolean(
  value: boolean | null,
  labels?: { false?: string; true?: string; unknown?: string },
) {
  if (value === true) return labels?.true ?? 'Yes';
  if (value === false) return labels?.false ?? 'No';
  return labels?.unknown ?? 'Unknown';
}

function formatNumber(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Unknown';
  return new Intl.NumberFormat('en-US').format(value);
}

function formatApiAvailability(value: boolean | null) {
  return formatBoolean(value, {
    false: 'Unavailable',
    true: 'Available',
    unknown: 'Unknown',
  });
}

function formatCodecSupport(value: boolean | null) {
  return formatBoolean(value, {
    false: 'No',
    true: 'Yes',
    unknown: 'Unknown',
  });
}

function formatCodecDiagnostics(result: VideoCodecDiagnosticsResult) {
  return [
    `HW encode: ${formatCodecSupport(result.hardwareEncodeSupported)}`,
    `SW encode: ${formatCodecSupport(result.softwareEncodeSupported)}`,
    `Decode: ${formatCodecSupport(result.decodeSupported)}`,
  ].join(' | ');
}

function shouldSuggestLinuxChromiumVulkan(params: {
  adapterRequestStatus: string;
  apiAvailable: boolean;
  userAgent: string | null;
}) {
  const userAgent = params.userAgent ?? '';

  return (
    params.apiAvailable &&
    params.adapterRequestStatus === 'requestAdapter returned null' &&
    /\bLinux\b/i.test(userAgent) &&
    /\bChrome\//i.test(userAgent) &&
    !/\bEdg\//i.test(userAgent)
  );
}

function buildStatus(label: string, tone: VideoDiagnosticsStatus['tone']): VideoDiagnosticsStatus {
  return { label, tone };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

async function getVideoEncoderSupport(
  browser: BrowserLike,
  probe: VideoDiagnosticsProbeOptions,
  hardwareAcceleration: 'prefer-hardware' | 'prefer-software',
): Promise<boolean | null> {
  if (!browser.VideoEncoder?.isConfigSupported) return null;

  try {
    const result = await browser.VideoEncoder.isConfigSupported({
      bitrate: probe.videoBitrate,
      codec: probe.videoCodec,
      framerate: probe.framerate,
      hardwareAcceleration,
      height: probe.height,
      width: probe.width,
    });

    return result?.supported === true;
  } catch {
    return false;
  }
}

async function getAudioEncoderSupport(
  browser: BrowserLike,
  probe: VideoDiagnosticsProbeOptions,
): Promise<boolean | null> {
  if (!browser.AudioEncoder?.isConfigSupported) return null;

  try {
    const result = await browser.AudioEncoder.isConfigSupported({
      bitrate: probe.audioBitrate,
      codec: probe.audioCodec,
      numberOfChannels: probe.audioChannels,
      sampleRate: probe.audioSampleRate,
    });

    return result?.supported === true;
  } catch {
    return false;
  }
}

async function getVideoDecoderSupport(
  browser: BrowserLike,
  probe: VideoDiagnosticsProbeOptions,
): Promise<boolean | null> {
  if (!browser.VideoDecoder?.isConfigSupported) return null;

  try {
    const result = await browser.VideoDecoder.isConfigSupported({
      codec: probe.videoCodec,
      codedHeight: probe.height,
      codedWidth: probe.width,
    });

    return result?.supported === true;
  } catch {
    return false;
  }
}

async function getVideoCodecDiagnostics(
  browser: BrowserLike,
  probe: VideoDiagnosticsProbeOptions,
): Promise<VideoCodecDiagnosticsResult[]> {
  return Promise.all(
    BASE_VIDEO_CODEC_OPTIONS.map(async (codec) => {
      const codecProbe = {
        ...probe,
        videoCodec: codec.value,
      };
      const [hardwareEncodeSupported, softwareEncodeSupported, decodeSupported] = await Promise.all(
        [
          getVideoEncoderSupport(browser, codecProbe, 'prefer-hardware'),
          getVideoEncoderSupport(browser, codecProbe, 'prefer-software'),
          getVideoDecoderSupport(browser, codecProbe),
        ],
      );

      return {
        decodeSupported,
        hardwareEncodeSupported,
        label: codec.label,
        softwareEncodeSupported,
        value: codec.value,
      };
    }),
  );
}

async function getEncodingInfo(
  navigatorObject: NavigatorLike,
  probe: VideoDiagnosticsProbeOptions,
): Promise<MediaCapabilitiesInfoLike | null> {
  if (!navigatorObject.mediaCapabilities?.encodingInfo) return null;

  const mimeCodec = probe.videoCodec.startsWith('avc1')
    ? `video/mp4;codecs=${probe.videoCodec}`
    : `video/webm;codecs=${probe.videoCodec}`;

  try {
    return await navigatorObject.mediaCapabilities.encodingInfo({
      type: 'record',
      video: {
        bitrate: probe.videoBitrate,
        contentType: mimeCodec,
        framerate: probe.framerate,
        height: probe.height,
        width: probe.width,
      },
    });
  } catch {
    return null;
  }
}

function createUnavailableWebGlInfo(supported: boolean | null): WebGlInfo {
  return {
    context: null,
    maxRenderbufferSize: null,
    maxTextureSize: null,
    renderer: null,
    shadingLanguageVersion: null,
    supported,
    vendor: null,
    version: null,
  };
}

function readWebGlInfoFromCanvas(canvas: CanvasLike): WebGlInfo {
  const contextNames = ['webgl2', 'webgl', 'experimental-webgl'] as const;
  let context: WebGlRenderingContextLike | null = null;
  let contextName: string | null = null;

  for (const name of contextNames) {
    context = canvas.getContext(name) as WebGlRenderingContextLike | null;
    if (context) {
      contextName = name;
      break;
    }
  }

  if (!context) return createUnavailableWebGlInfo(false);

  const extension = context.getExtension?.('WEBGL_debug_renderer_info') ?? null;
  const renderer = extension?.UNMASKED_RENDERER_WEBGL
    ? context.getParameter(extension.UNMASKED_RENDERER_WEBGL)
    : context.RENDERER !== undefined
      ? context.getParameter(context.RENDERER)
      : null;
  const vendor = extension?.UNMASKED_VENDOR_WEBGL
    ? context.getParameter(extension.UNMASKED_VENDOR_WEBGL)
    : context.VENDOR !== undefined
      ? context.getParameter(context.VENDOR)
      : null;
  const version = context.VERSION !== undefined ? context.getParameter(context.VERSION) : null;
  const shadingLanguageVersion =
    context.SHADING_LANGUAGE_VERSION !== undefined
      ? context.getParameter(context.SHADING_LANGUAGE_VERSION)
      : null;
  const maxTextureSize =
    context.MAX_TEXTURE_SIZE !== undefined ? context.getParameter(context.MAX_TEXTURE_SIZE) : null;
  const maxRenderbufferSize =
    context.MAX_RENDERBUFFER_SIZE !== undefined
      ? context.getParameter(context.MAX_RENDERBUFFER_SIZE)
      : null;

  return {
    context: contextName,
    maxRenderbufferSize: typeof maxRenderbufferSize === 'number' ? maxRenderbufferSize : null,
    maxTextureSize: typeof maxTextureSize === 'number' ? maxTextureSize : null,
    renderer: typeof renderer === 'string' && renderer.length > 0 ? renderer : null,
    shadingLanguageVersion:
      typeof shadingLanguageVersion === 'string' && shadingLanguageVersion.length > 0
        ? shadingLanguageVersion
        : null,
    supported: true,
    vendor: typeof vendor === 'string' && vendor.length > 0 ? vendor : null,
    version: typeof version === 'string' && version.length > 0 ? version : null,
  };
}

function getWebGlInfo(createCanvas?: GatherVideoDiagnosticsOptions['createCanvas']): WebGlInfo {
  if (!createCanvas) {
    return createUnavailableWebGlInfo(null);
  }

  try {
    return readWebGlInfoFromCanvas(createCanvas());
  } catch {
    return createUnavailableWebGlInfo(false);
  }
}

function getOffscreenWebGlInfo(browser: BrowserLike): WebGlInfo {
  if (typeof browser.OffscreenCanvas === 'undefined') return createUnavailableWebGlInfo(null);

  try {
    const canvas = new browser.OffscreenCanvas(1, 1);
    return readWebGlInfoFromCanvas(canvas as unknown as CanvasLike);
  } catch {
    return createUnavailableWebGlInfo(false);
  }
}

function createUnavailableWebGpuInfo(params: {
  adapterRequestError?: string | null;
  adapterRequestStatus: string;
  apiAvailable: boolean;
}): WebGpuInfo {
  return {
    adapterAvailable: false,
    adapterRequestError: params.adapterRequestError ?? null,
    adapterRequestStatus: params.adapterRequestStatus,
    apiAvailable: params.apiAvailable,
    architecture: null,
    description: null,
    device: null,
    deviceAvailable: false,
    deviceRequestError: null,
    deviceRequestStatus: params.apiAvailable ? 'Not requested' : 'Unavailable',
    featureCount: null,
    maxBufferSize: null,
    maxTextureDimension2D: null,
    vendor: null,
  };
}

async function getWebGpuInfo(navigatorObject: NavigatorLike): Promise<WebGpuInfo> {
  if (!navigatorObject.gpu?.requestAdapter) {
    return createUnavailableWebGpuInfo({
      adapterRequestStatus: 'WebGPU API unavailable',
      apiAvailable: false,
    });
  }

  try {
    const adapter = await navigatorObject.gpu.requestAdapter();
    if (!adapter) {
      return createUnavailableWebGpuInfo({
        adapterRequestStatus: 'requestAdapter returned null',
        apiAvailable: true,
      });
    }

    const features = adapter.features ? Array.from(adapter.features) : [];
    let deviceAvailable = false;
    let deviceRequestError: string | null = null;
    let deviceRequestStatus = 'requestDevice unavailable';

    if (typeof adapter.requestDevice === 'function') {
      try {
        const device = (await adapter.requestDevice()) as GPUDeviceLike;
        deviceAvailable = true;
        deviceRequestStatus = 'Available';
        device.destroy?.();
      } catch (error) {
        deviceAvailable = false;
        deviceRequestError = getErrorMessage(error);
        deviceRequestStatus = 'requestDevice failed';
      }
    }

    return {
      adapterAvailable: true,
      adapterRequestError: null,
      adapterRequestStatus: 'Available',
      apiAvailable: true,
      architecture: adapter.info?.architecture || null,
      description: adapter.info?.description || null,
      device: adapter.info?.device || null,
      deviceAvailable,
      deviceRequestError,
      deviceRequestStatus,
      featureCount: features.length,
      maxBufferSize:
        typeof adapter.limits?.maxBufferSize === 'number' ? adapter.limits.maxBufferSize : null,
      maxTextureDimension2D:
        typeof adapter.limits?.maxTextureDimension2D === 'number'
          ? adapter.limits.maxTextureDimension2D
          : null,
      vendor: adapter.info?.vendor || null,
    };
  } catch (error) {
    return createUnavailableWebGpuInfo({
      adapterRequestError: getErrorMessage(error),
      adapterRequestStatus: 'requestAdapter failed',
      apiAvailable: true,
    });
  }
}

const GPU_COVERAGE_PATH_LABELS: Record<string, string> = {
  effects: 'Video / image effects',
  'blur-fill': 'Blur-fill background',
  transition: 'Shader transitions',
  adjustment: 'Adjustment layers',
  'non-video': 'Text / shape effects',
};

/**
 * Turns the compositor's session-cumulative zero-copy coverage into a
 * diagnostics section. `null` (no snapshot / no effect work sampled yet) is
 * rendered by the caller as "not sampled" rather than a fake 0%.
 */
function buildCompositorCoverageSection(
  perf: GpuCoverageSnapshot | null,
): VideoDiagnosticsSection | null {
  if (!perf) {
    return null;
  }
  if (perf.overall.total === 0) {
    return {
      description:
        'Fraction of effect work that ran fully on the GPU (zero-copy) versus a bitmap round-trip or skipped effects. Cumulative for this session; play a clip with effects to sample it.',
      items: [{ label: 'Effect operations sampled', value: '0 (none yet)' }],
      status: buildStatus('No effect work sampled yet', 'neutral'),
      title: 'GPU zero-copy coverage',
    };
  }

  const { overall } = perf;
  const status =
    overall.rawFallback > 0
      ? buildStatus(`${overall.zeroCopyPct}% zero-copy — effects skipped on some frames`, 'danger')
      : overall.bitmapFallback > 0
        ? buildStatus(`${overall.zeroCopyPct}% zero-copy — bitmap fallback in use`, 'warning')
        : buildStatus(`${overall.zeroCopyPct}% zero-copy`, 'success');

  const items: VideoDiagnosticsKeyValueItem[] = [
    { label: 'Zero-copy', value: `${overall.zeroCopy} (${overall.zeroCopyPct}%)` },
    { label: 'Bitmap fallback', value: String(overall.bitmapFallback) },
    { label: 'Skipped (raw fallback)', value: String(overall.rawFallback) },
    { label: 'Total effect operations', value: String(overall.total) },
  ];
  for (const [path, bucket] of Object.entries(perf.byPath)) {
    if (!bucket || bucket.total === 0) continue;
    const label = GPU_COVERAGE_PATH_LABELS[path] ?? path;
    const pct = Math.round((bucket.zeroCopy / bucket.total) * 100);
    items.push({
      label,
      value: `${pct}% zero-copy (${bucket.bitmapFallback} bitmap, ${bucket.rawFallback} skipped)`,
    });
  }

  return {
    description:
      'Fraction of effect work that ran fully on the GPU (zero-copy) versus a bitmap round-trip or skipped effects. Cumulative for this session.',
    items,
    status,
    title: 'GPU zero-copy coverage',
  };
}

export function createVideoDiagnosticsSnapshot(params: {
  audioEncoderSupported: boolean | null;
  crossOriginIsolated: boolean | null;
  createImageBitmapSupported: boolean | null;
  encodingInfo: MediaCapabilitiesInfoLike | null;
  mediaCapabilitiesEncodingSupported: boolean | null;
  offscreenCanvas2dSupported: boolean | null;
  offscreenCanvasSupported: boolean | null;
  offscreenWebGlInfo: WebGlInfo;
  videoDecoderSupported: boolean | null;
  videoEncoderHardwareSupported: boolean | null;
  videoEncoderSoftwareSupported: boolean | null;
  videoCodecDiagnostics: VideoCodecDiagnosticsResult[];
  webGlInfo: WebGlInfo;
  webGpuInfo: Awaited<ReturnType<typeof getWebGpuInfo>>;
  workerWebGpuInfo: { supported: boolean; error: string | null } | null;
  compositorPerf?: GpuCoverageSnapshot | null;
  secureContext: boolean | null;
  selectedVideoCodec: string;
  userAgent: string | null;
}): VideoDiagnosticsSnapshot {
  const compositorReady =
    (params.webGlInfo.supported === true || params.offscreenWebGlInfo.supported === true) &&
    params.offscreenCanvasSupported !== false;
  const webGpuReady =
    params.webGpuInfo.adapterAvailable === true && params.webGpuInfo.deviceAvailable !== false;

  const compositorStatus = compositorReady
    ? webGpuReady
      ? params.workerWebGpuInfo?.supported === false
        ? buildStatus(
            'Ready for Pixi GPU compositor (WebGL fallback: WebGPU unavailable in Worker)',
            'warning',
          )
        : buildStatus('Ready for Pixi GPU compositor with WebGPU available', 'success')
      : buildStatus('Ready for Pixi GPU compositor using WebGL fallback', 'success')
    : params.webGlInfo.supported === false && params.offscreenWebGlInfo.supported === false
      ? buildStatus('Preview compositor is limited: WebGL is unavailable', 'danger')
      : buildStatus('Preview compositor availability is partially unknown', 'warning');

  const webCodecsReady =
    params.videoEncoderHardwareSupported === true || params.videoEncoderSoftwareSupported === true;

  const webCodecsStatus = webCodecsReady
    ? buildStatus('WebCodecs encoding path is available', 'success')
    : params.videoEncoderHardwareSupported === false &&
        params.videoEncoderSoftwareSupported === false
      ? buildStatus('WebCodecs encoding is not supported for the current codec', 'danger')
      : buildStatus('WebCodecs support could not be fully verified', 'warning');

  const importReady =
    params.videoDecoderSupported !== false &&
    params.createImageBitmapSupported !== false &&
    params.offscreenCanvas2dSupported !== false;

  const importStatus = importReady
    ? buildStatus('Import and frame preparation APIs are available', 'success')
    : buildStatus('Some import or frame preparation APIs are unavailable', 'warning');
  const suggestLinuxChromiumVulkan = shouldSuggestLinuxChromiumVulkan({
    adapterRequestStatus: params.webGpuInfo.adapterRequestStatus,
    apiAvailable: params.webGpuInfo.apiAvailable,
    userAgent: params.userAgent,
  });

  const compositorCoverageSection = buildCompositorCoverageSection(params.compositorPerf ?? null);

  const sections: VideoDiagnosticsSection[] = [
    {
      description:
        'These capabilities affect compositing across preview and export. Pixi is initialized with the selected renderer preference and may fall back automatically if unavailable.',
      items: [
        {
          label: 'Compositor path',
          value: compositorReady
            ? webGpuReady
              ? 'Pixi GPU renderer (WebGPU preferred, WebGL fallback)'
              : 'Pixi GPU renderer (WebGL fallback)'
            : 'Limited or fallback-only',
        },
        {
          label: 'WebGPU adapter',
          value: formatBoolean(params.webGpuInfo.adapterAvailable),
        },
        {
          label: 'WebGPU device request',
          value: formatBoolean(params.webGpuInfo.deviceAvailable ?? null),
        },
        {
          label: 'WebGL available',
          value: formatBoolean(params.webGlInfo.supported),
        },
        {
          label: 'WebGL context',
          value: params.webGlInfo.context ?? 'Unavailable',
        },
        {
          label: 'OffscreenCanvas WebGL',
          value: formatBoolean(params.offscreenWebGlInfo.supported),
        },
        {
          label: 'OffscreenCanvas WebGL context',
          value: params.offscreenWebGlInfo.context ?? 'Unavailable',
        },
        {
          label: 'OffscreenCanvas available',
          value: formatBoolean(params.offscreenCanvasSupported),
        },
        {
          label: 'OffscreenCanvas 2D context',
          value: formatBoolean(params.offscreenCanvas2dSupported),
        },
        {
          label: 'GPU vendor',
          value: params.webGlInfo.vendor ?? 'Unavailable',
        },
        {
          label: 'GPU renderer',
          value: params.webGlInfo.renderer ?? 'Unavailable',
        },
        {
          label: 'WebGL version',
          value: params.webGlInfo.version ?? 'Unavailable',
        },
        {
          label: 'GLSL version',
          value: params.webGlInfo.shadingLanguageVersion ?? 'Unavailable',
        },
        {
          label: 'Max texture size',
          value: formatNumber(params.webGlInfo.maxTextureSize),
        },
        {
          label: 'Max renderbuffer size',
          value: formatNumber(params.webGlInfo.maxRenderbufferSize),
        },
      ],
      status: compositorStatus,
      title: 'Preview compositor',
    },
    ...(compositorCoverageSection ? [compositorCoverageSection] : []),
    {
      description:
        'These APIs affect media metadata extraction, image import, video decoding and frame preparation before compositing.',
      items: [
        {
          label: 'VideoDecoder API',
          value: formatApiAvailability(params.videoDecoderSupported),
        },
        {
          label: 'Selected video decoder config',
          value: formatBoolean(params.videoDecoderSupported, {
            false: 'Unsupported',
            true: 'Supported',
            unknown: 'Unknown',
          }),
        },
        {
          label: 'createImageBitmap API',
          value: formatApiAvailability(params.createImageBitmapSupported),
        },
        {
          label: 'OffscreenCanvas 2D context',
          value: formatBoolean(params.offscreenCanvas2dSupported),
        },
        ...params.videoCodecDiagnostics.map((codec) => ({
          label: `${codec.label} decode (${codec.value})`,
          value: formatCodecSupport(codec.decodeSupported),
        })),
      ],
      status: importStatus,
      title: 'Import and decode path',
    },
    {
      description:
        'These capabilities affect Mediabunny CanvasSource exports, browser-side encoding and hardware acceleration hints.',
      items: [
        {
          label: 'Selected video codec',
          value:
            params.videoCodecDiagnostics.find((codec) => codec.value === params.selectedVideoCodec)
              ?.label ?? params.selectedVideoCodec,
        },
        {
          label: 'VideoEncoder API',
          value:
            params.videoEncoderHardwareSupported !== null ||
            params.videoEncoderSoftwareSupported !== null
              ? 'Available'
              : 'Unavailable',
        },
        {
          label: 'AudioEncoder API',
          value: formatApiAvailability(params.audioEncoderSupported),
        },
        {
          label: 'Selected video hardware encode',
          value: formatBoolean(params.videoEncoderHardwareSupported),
        },
        {
          label: 'Selected video software encode',
          value: formatBoolean(params.videoEncoderSoftwareSupported),
        },
        {
          label: 'Selected audio encode',
          value: formatBoolean(params.audioEncoderSupported, {
            false: 'Unsupported',
            true: 'Supported',
            unknown: 'Unknown',
          }),
        },
        {
          label: 'MediaCapabilities encoding API',
          value: formatApiAvailability(params.mediaCapabilitiesEncodingSupported),
        },
        {
          label: 'MediaCapabilities selected config',
          value: formatBoolean(params.encodingInfo?.supported ?? null),
        },
        {
          label: 'MediaCapabilities smooth',
          value: formatBoolean(params.encodingInfo?.smooth ?? null),
        },
        {
          label: 'MediaCapabilities power efficient',
          value: formatBoolean(params.encodingInfo?.powerEfficient ?? null),
        },
        ...params.videoCodecDiagnostics.map((codec) => ({
          label: `${codec.label} (${codec.value})`,
          value: formatCodecDiagnostics(codec),
        })),
      ],
      status: webCodecsStatus,
      title: 'WebCodecs export path',
    },
    {
      description:
        'WebGPU adapter detection depends on the current browser or WebView, OS graphics stack, driver allowlist and secure-context policy. WebGL can still use the GPU when this adapter is unavailable.',
      items: [
        {
          label: 'WebGPU in Worker context',
          value: params.workerWebGpuInfo
            ? params.workerWebGpuInfo.supported
              ? 'Available'
              : `Unavailable: ${params.workerWebGpuInfo.error}`
            : 'Not checked',
        },
        {
          label: 'WebGPU API',
          value: formatApiAvailability(params.webGpuInfo.apiAvailable),
        },
        {
          label: 'Secure context',
          value: formatBoolean(params.secureContext),
        },
        {
          label: 'Cross-origin isolated',
          value: formatBoolean(params.crossOriginIsolated),
        },
        {
          label: 'Adapter request',
          value: params.webGpuInfo.adapterRequestStatus,
        },
        ...(suggestLinuxChromiumVulkan
          ? [
              {
                label: 'Linux Chromium hint',
                value: 'Enable chrome://flags/#enable-vulkan, then restart Chromium/Chrome.',
              },
            ]
          : []),
        {
          label: 'Adapter request error',
          value: params.webGpuInfo.adapterRequestError ?? 'None',
        },
        {
          label: 'Adapter available',
          value: formatBoolean(params.webGpuInfo.adapterAvailable),
        },
        {
          label: 'Device request',
          value: params.webGpuInfo.deviceRequestStatus,
        },
        {
          label: 'Device request error',
          value: params.webGpuInfo.deviceRequestError ?? 'None',
        },
        {
          label: 'Vendor',
          value: params.webGpuInfo.vendor ?? 'Unavailable',
        },
        {
          label: 'Architecture',
          value: params.webGpuInfo.architecture ?? 'Unavailable',
        },
        {
          label: 'Device',
          value: params.webGpuInfo.device ?? 'Unavailable',
        },
        {
          label: 'Description',
          value: params.webGpuInfo.description ?? 'Unavailable',
        },
        {
          label: 'Feature count',
          value: formatNumber(params.webGpuInfo.featureCount),
        },
        {
          label: 'Max texture dimension 2D',
          value: formatNumber(params.webGpuInfo.maxTextureDimension2D),
        },
        {
          label: 'Max buffer size',
          value: formatNumber(params.webGpuInfo.maxBufferSize),
        },
        {
          label: 'Runtime',
          value: params.userAgent ?? 'Unavailable',
        },
      ],
      status: params.webGpuInfo.adapterAvailable
        ? buildStatus('Detected and requested first by Pixi when available', 'neutral')
        : params.webGpuInfo.apiAvailable
          ? buildStatus(params.webGpuInfo.adapterRequestStatus, 'warning')
          : buildStatus('WebGPU API unavailable in this runtime', 'warning'),
      title: 'WebGPU diagnostics',
    },
  ];

  const summary =
    compositorReady && webCodecsReady && importReady
      ? buildStatus('Hardware-accelerated browser media path looks healthy', 'success')
      : compositorReady || webCodecsReady || importReady
        ? buildStatus('Some acceleration paths are available, but not all', 'warning')
        : buildStatus('Browser acceleration capabilities are limited', 'danger');

  return {
    sections,
    summary,
  };
}

export async function gatherVideoDiagnostics(
  options: GatherVideoDiagnosticsOptions,
): Promise<VideoDiagnosticsSnapshot> {
  const browser = options.browser ?? (globalThis as unknown as BrowserLike);
  const navigatorObject =
    options.navigatorObject ?? (globalThis.navigator as unknown as NavigatorLike);
  const offscreenCanvasSupported = typeof browser.OffscreenCanvas !== 'undefined';
  const secureContext =
    typeof browser.isSecureContext === 'boolean' ? browser.isSecureContext : null;
  const crossOriginIsolated =
    typeof browser.crossOriginIsolated === 'boolean' ? browser.crossOriginIsolated : null;
  const createImageBitmapSupported = typeof browser.createImageBitmap === 'function';
  const mediaCapabilitiesEncodingSupported =
    typeof navigatorObject.mediaCapabilities?.encodingInfo === 'function';

  let offscreenCanvas2dSupported: boolean | null = null;
  if (offscreenCanvasSupported) {
    try {
      const canvas = new browser.OffscreenCanvas!(1, 1);
      offscreenCanvas2dSupported = Boolean(canvas.getContext('2d'));
    } catch {
      offscreenCanvas2dSupported = false;
    }
  }

  const [
    videoEncoderHardwareSupported,
    videoEncoderSoftwareSupported,
    videoDecoderSupported,
    audioEncoderSupported,
    encodingInfo,
    videoCodecDiagnostics,
    workerWebGpuInfo,
    compositorPerf,
  ] = await Promise.all([
    getVideoEncoderSupport(browser, options.probe, 'prefer-hardware'),
    getVideoEncoderSupport(browser, options.probe, 'prefer-software'),
    getVideoDecoderSupport(browser, options.probe),
    getAudioEncoderSupport(browser, options.probe),
    getEncodingInfo(navigatorObject, options.probe),
    getVideoCodecDiagnostics(browser, options.probe),
    options.checkWorkerWebGpu
      ? options.checkWorkerWebGpu().catch((err) => ({ supported: false, error: String(err) }))
      : Promise.resolve(null),
    options.getCompositorPerf
      ? options.getCompositorPerf().catch(() => null)
      : Promise.resolve(null),
  ]);

  const webGlInfo = getWebGlInfo(options.createCanvas);
  const offscreenWebGlInfo = getOffscreenWebGlInfo(browser);
  const webGpuInfo = await getWebGpuInfo(navigatorObject);

  return createVideoDiagnosticsSnapshot({
    audioEncoderSupported,
    crossOriginIsolated,
    createImageBitmapSupported,
    encodingInfo,
    mediaCapabilitiesEncodingSupported,
    offscreenCanvas2dSupported,
    offscreenCanvasSupported,
    offscreenWebGlInfo,
    videoDecoderSupported,
    videoEncoderHardwareSupported,
    videoEncoderSoftwareSupported,
    videoCodecDiagnostics,
    webGlInfo,
    webGpuInfo,
    workerWebGpuInfo,
    compositorPerf,
    secureContext,
    selectedVideoCodec: options.probe.videoCodec,
    userAgent: navigatorObject.userAgent ?? null,
  });
}
