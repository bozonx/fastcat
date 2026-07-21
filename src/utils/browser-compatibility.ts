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

export type BrowserFamily = 'chrome' | 'edge' | 'firefox' | 'safari' | 'unknown';

export interface BrowserGpuFlagInfo {
  browserFamily: BrowserFamily;
  browserDisplayName: string;
  flagUrl?: string;
  flagName?: string;
  instructions: string;
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

export function getGpuMockFromQuery(): boolean | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const mockGpu = params.get('mock_gpu');
  if (mockGpu === 'none' || mockGpu === '0' || mockGpu === 'false' || mockGpu === 'webgl') {
    return false;
  }
  if (mockGpu === 'webgpu' || mockGpu === '1' || mockGpu === 'true') {
    return true;
  }
  return null;
}

export function getBrowserOverrideFromQuery(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const params = new URLSearchParams(window.location.search);
  return params.get('mock_browser') || undefined;
}

export function detectBrowserGpuFlagInfo(overrideBrowser?: string): BrowserGpuFlagInfo {
  let ua = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';
  const forcedBrowser = overrideBrowser || getBrowserOverrideFromQuery();
  if (forcedBrowser) {
    ua = forcedBrowser.toLowerCase();
  }

  if (ua.includes('edg/') || ua === 'edge') {
    return {
      browserFamily: 'edge',
      browserDisplayName: 'Microsoft Edge',
      flagUrl: 'edge://flags/#enable-unsafe-webgpu',
      flagName: 'enable-unsafe-webgpu',
      instructions: 'Вставьте ссылку в адресную строку Edge и установите параметр в положение Enabled. Также убедитесь, что включено аппаратное ускорение в edge://settings/system.',
    };
  }

  if (ua.includes('firefox') || ua === 'firefox') {
    return {
      browserFamily: 'firefox',
      browserDisplayName: 'Mozilla Firefox',
      flagUrl: 'about:config',
      flagName: 'dom.webgpu.enabled',
      instructions: 'Введите about:config в адресной строке Firefox, найдите параметр dom.webgpu.enabled и переключите его на true.',
    };
  }

  if ((ua.includes('safari') && !ua.includes('chrome')) || ua === 'safari') {
    return {
      browserFamily: 'safari',
      browserDisplayName: 'Apple Safari',
      instructions: 'В Safari откройте Настройки -> Дополнительно -> «Показать меню Разработка». Затем в меню Разработка -> Feature Flags включите WebGPU.',
    };
  }

  if (ua.includes('chrome') || ua.includes('chromium') || ua === 'chrome') {
    return {
      browserFamily: 'chrome',
      browserDisplayName: 'Google Chrome / Chromium',
      flagUrl: 'chrome://flags/#enable-unsafe-webgpu',
      flagName: 'enable-unsafe-webgpu',
      instructions: 'Вставьте ссылку в адресную строку Chrome и установите параметр в положение Enabled. Также проверьте настройки аппаратного ускорения в chrome://settings/system.',
    };
  }

  return {
    browserFamily: 'unknown',
    browserDisplayName: 'Ваш браузер',
    instructions: 'Для поддержки WebGPU рекомендуется использовать актуальные версии Google Chrome, Microsoft Edge или Yandex Browser с включённым аппаратным ускорением.',
  };
}

export function evaluateBrowserCompatibility(): BrowserCompatibilityReport {
  const queryMock = getGpuMockFromQuery();
  const webGpuSupported =
    queryMock !== null
      ? queryMock
      : typeof navigator !== 'undefined' && !!navigator.gpu;

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
      supported: webGpuSupported,
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
