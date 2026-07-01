export type BrowserCompatibilitySeverity = 'critical' | 'warning';

export interface BrowserCompatibilityCheck {
  id: string;
  labelKey: string;
  descriptionKey: string;
  supported: boolean;
  severity: BrowserCompatibilitySeverity;
}

export interface BrowserCompatibilityReport {
  checks: BrowserCompatibilityCheck[];
  criticalFailures: BrowserCompatibilityCheck[];
  warnings: BrowserCompatibilityCheck[];
  isSupported: boolean;
}

function hasStorageDirectory(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';
}

function hasWebCodecsVideo(): boolean {
  const browser = globalThis as unknown as {
    VideoDecoder?: unknown;
    VideoEncoder?: unknown;
  };
  return typeof browser.VideoDecoder === 'function' && typeof browser.VideoEncoder === 'function';
}

function hasSharedArrayBufferIsolation(): boolean {
  return typeof SharedArrayBuffer === 'function' && globalThis.crossOriginIsolated === true;
}

function hasAudioWebCodecs(): boolean {
  const browser = globalThis as unknown as {
    AudioDecoder?: unknown;
    AudioEncoder?: unknown;
  };
  return typeof browser.AudioDecoder === 'function' && typeof browser.AudioEncoder === 'function';
}

export function evaluateBrowserCompatibility(): BrowserCompatibilityReport {
  const checks: BrowserCompatibilityCheck[] = [
    {
      id: 'opfs',
      labelKey: 'fastcat.browserCompatibility.checks.opfs.label',
      descriptionKey: 'fastcat.browserCompatibility.checks.opfs.description',
      supported: hasStorageDirectory(),
      severity: 'critical',
    },
    {
      id: 'indexeddb',
      labelKey: 'fastcat.browserCompatibility.checks.indexedDb.label',
      descriptionKey: 'fastcat.browserCompatibility.checks.indexedDb.description',
      supported: typeof indexedDB !== 'undefined',
      severity: 'critical',
    },
    {
      id: 'worker',
      labelKey: 'fastcat.browserCompatibility.checks.worker.label',
      descriptionKey: 'fastcat.browserCompatibility.checks.worker.description',
      supported: typeof Worker === 'function',
      severity: 'critical',
    },
    {
      id: 'offscreen-canvas',
      labelKey: 'fastcat.browserCompatibility.checks.offscreenCanvas.label',
      descriptionKey: 'fastcat.browserCompatibility.checks.offscreenCanvas.description',
      supported: typeof OffscreenCanvas === 'function',
      severity: 'critical',
    },
    {
      id: 'create-image-bitmap',
      labelKey: 'fastcat.browserCompatibility.checks.createImageBitmap.label',
      descriptionKey: 'fastcat.browserCompatibility.checks.createImageBitmap.description',
      supported: typeof createImageBitmap === 'function',
      severity: 'critical',
    },
    {
      id: 'webcodecs-video',
      labelKey: 'fastcat.browserCompatibility.checks.webCodecsVideo.label',
      descriptionKey: 'fastcat.browserCompatibility.checks.webCodecsVideo.description',
      supported: hasWebCodecsVideo(),
      severity: 'critical',
    },
    {
      id: 'shared-array-buffer',
      labelKey: 'fastcat.browserCompatibility.checks.sharedArrayBuffer.label',
      descriptionKey: 'fastcat.browserCompatibility.checks.sharedArrayBuffer.description',
      supported: hasSharedArrayBufferIsolation(),
      severity: 'critical',
    },
    {
      id: 'webcodecs-audio',
      labelKey: 'fastcat.browserCompatibility.checks.webCodecsAudio.label',
      descriptionKey: 'fastcat.browserCompatibility.checks.webCodecsAudio.description',
      supported: hasAudioWebCodecs(),
      severity: 'warning',
    },
    {
      id: 'webgpu',
      labelKey: 'fastcat.browserCompatibility.checks.webGpu.label',
      descriptionKey: 'fastcat.browserCompatibility.checks.webGpu.description',
      supported: typeof navigator !== 'undefined' && !!navigator.gpu,
      severity: 'warning',
    },
  ];

  const criticalFailures = checks.filter(
    (check) => check.severity === 'critical' && !check.supported,
  );
  const warnings = checks.filter((check) => check.severity === 'warning' && !check.supported);

  return {
    checks,
    criticalFailures,
    warnings,
    isSupported: criticalFailures.length === 0,
  };
}
