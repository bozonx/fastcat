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
  OffscreenCanvas?: new (width: number, height: number) => OffscreenCanvas;
  VideoEncoder?: {
    isConfigSupported?: (config: Record<string, unknown>) => Promise<{ supported?: boolean }>;
  };
}

interface NavigatorLike {
  gpu?: {
    requestAdapter?: () => Promise<GPUAdapterLike | null>;
  };
  mediaCapabilities?: {
    encodingInfo?: (config: Record<string, unknown>) => Promise<MediaCapabilitiesInfoLike>;
  };
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
}

interface MediaCapabilitiesInfoLike {
  powerEfficient?: boolean;
  smooth?: boolean;
  supported?: boolean;
}

interface WebGlRenderingContextLike {
  MAX_TEXTURE_SIZE?: number;
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

interface GatherVideoDiagnosticsOptions {
  browser?: BrowserLike;
  createCanvas?: () => CanvasLike;
  navigatorObject?: NavigatorLike;
  probe: VideoDiagnosticsProbeOptions;
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

function buildStatus(label: string, tone: VideoDiagnosticsStatus['tone']): VideoDiagnosticsStatus {
  return { label, tone };
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

function getWebGlInfo(createCanvas?: GatherVideoDiagnosticsOptions['createCanvas']) {
  if (!createCanvas) {
    return {
      maxTextureSize: null,
      renderer: null,
      shadingLanguageVersion: null,
      supported: null,
      vendor: null,
      version: null,
    };
  }

  try {
    const canvas = createCanvas();
    const context =
      (canvas.getContext('webgl2') as WebGlRenderingContextLike | null) ??
      (canvas.getContext('webgl') as WebGlRenderingContextLike | null) ??
      (canvas.getContext('experimental-webgl') as WebGlRenderingContextLike | null);

    if (!context) {
      return {
        maxTextureSize: null,
        renderer: null,
        shadingLanguageVersion: null,
        supported: false,
        vendor: null,
        version: null,
      };
    }

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
      context.MAX_TEXTURE_SIZE !== undefined
        ? context.getParameter(context.MAX_TEXTURE_SIZE)
        : null;

    return {
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
  } catch {
    return {
      maxTextureSize: null,
      renderer: null,
      shadingLanguageVersion: null,
      supported: false,
      vendor: null,
      version: null,
    };
  }
}

async function getWebGpuInfo(navigatorObject: NavigatorLike) {
  if (!navigatorObject.gpu?.requestAdapter) {
    return {
      adapterAvailable: false,
      architecture: null,
      description: null,
      device: null,
      featureCount: null,
      maxBufferSize: null,
      maxTextureDimension2D: null,
      vendor: null,
    };
  }

  try {
    const adapter = await navigatorObject.gpu.requestAdapter();
    if (!adapter) {
      return {
        adapterAvailable: false,
        architecture: null,
        description: null,
        device: null,
        featureCount: null,
        maxBufferSize: null,
        maxTextureDimension2D: null,
        vendor: null,
      };
    }

    const features = adapter.features ? Array.from(adapter.features) : [];

    return {
      adapterAvailable: true,
      architecture: adapter.info?.architecture || null,
      description: adapter.info?.description || null,
      device: adapter.info?.device || null,
      featureCount: features.length,
      maxBufferSize:
        typeof adapter.limits?.maxBufferSize === 'number' ? adapter.limits.maxBufferSize : null,
      maxTextureDimension2D:
        typeof adapter.limits?.maxTextureDimension2D === 'number'
          ? adapter.limits.maxTextureDimension2D
          : null,
      vendor: adapter.info?.vendor || null,
    };
  } catch {
    return {
      adapterAvailable: false,
      architecture: null,
      description: null,
      device: null,
      featureCount: null,
      maxBufferSize: null,
      maxTextureDimension2D: null,
      vendor: null,
    };
  }
}

export function createVideoDiagnosticsSnapshot(params: {
  audioEncoderSupported: boolean | null;
  encodingInfo: MediaCapabilitiesInfoLike | null;
  offscreenCanvas2dSupported: boolean | null;
  offscreenCanvasSupported: boolean | null;
  videoEncoderHardwareSupported: boolean | null;
  videoEncoderSoftwareSupported: boolean | null;
  webGlInfo: ReturnType<typeof getWebGlInfo>;
  webGpuInfo: Awaited<ReturnType<typeof getWebGpuInfo>>;
}): VideoDiagnosticsSnapshot {
  const compositorReady =
    params.webGlInfo.supported === true && params.offscreenCanvasSupported !== false;

  const compositorStatus = compositorReady
    ? buildStatus('Ready for GPU preview compositor', 'success')
    : params.webGlInfo.supported === false
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

  const sections: VideoDiagnosticsSection[] = [
    {
      description:
        'These capabilities affect preview rendering in the monitor and timeline compositor.',
      items: [
        {
          label: 'Compositor path',
          value: compositorReady ? 'Pixi renderer on WebGPU' : 'Limited or fallback-only',
        },
        {
          label: 'WebGL available',
          value: formatBoolean(params.webGlInfo.supported),
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
      ],
      status: compositorStatus,
      title: 'Preview compositor',
    },
    {
      description:
        'These capabilities affect browser-side encoding and hardware acceleration in WebCodecs export paths.',
      items: [
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
          value: formatBoolean(params.audioEncoderSupported, {
            false: 'Unavailable or unsupported',
            true: 'Available',
            unknown: 'Unknown',
          }),
        },
        {
          label: 'Hardware encode support',
          value: formatBoolean(params.videoEncoderHardwareSupported),
        },
        {
          label: 'Software encode support',
          value: formatBoolean(params.videoEncoderSoftwareSupported),
        },
        {
          label: 'MediaCapabilities supported',
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
      ],
      status: webCodecsStatus,
      title: 'WebCodecs export path',
    },
    {
      description:
        'WebGPU information is diagnostic only right now. The current compositor code uses WebGPU (with WebGL fallback).',
      items: [
        {
          label: 'Adapter available',
          value: formatBoolean(params.webGpuInfo.adapterAvailable),
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
      ],
      status: params.webGpuInfo.adapterAvailable
        ? buildStatus('Detected, but not used by the current compositor path', 'neutral')
        : buildStatus('No WebGPU adapter detected', 'warning'),
      title: 'WebGPU diagnostics',
    },
  ];

  const summary =
    compositorReady && webCodecsReady
      ? buildStatus('Hardware-accelerated browser media path looks healthy', 'success')
      : compositorReady || webCodecsReady
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
    audioEncoderSupported,
    encodingInfo,
  ] = await Promise.all([
    getVideoEncoderSupport(browser, options.probe, 'prefer-hardware'),
    getVideoEncoderSupport(browser, options.probe, 'prefer-software'),
    getAudioEncoderSupport(browser, options.probe),
    getEncodingInfo(navigatorObject, options.probe),
  ]);

  const webGlInfo = getWebGlInfo(options.createCanvas);
  const webGpuInfo = await getWebGpuInfo(navigatorObject);

  return createVideoDiagnosticsSnapshot({
    audioEncoderSupported,
    encodingInfo,
    offscreenCanvas2dSupported,
    offscreenCanvasSupported,
    videoEncoderHardwareSupported,
    videoEncoderSoftwareSupported,
    webGlInfo,
    webGpuInfo,
  });
}
