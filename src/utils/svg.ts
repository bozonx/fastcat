export interface SvgDimensions {
  width: number;
  height: number;
}

export interface SvgRasterizeOptions {
  maxWidth?: number;
  maxHeight?: number;
}

export function parseSvgDimensions(svgText: string): SvgDimensions {
  const fallback: SvgDimensions = { width: 800, height: 600 };
  if (typeof svgText !== 'string' || svgText.length === 0) return fallback;

  try {
    if (typeof DOMParser !== 'undefined') {
      const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
      const svgEl = doc.querySelector('svg');
      if (!svgEl) return fallback;

      const widthAttr = svgEl.getAttribute('width');
      const heightAttr = svgEl.getAttribute('height');
      const viewBoxAttr = svgEl.getAttribute('viewBox');

      const width = parseSvgLengthPx(widthAttr);
      const height = parseSvgLengthPx(heightAttr);
      if (width && height) return { width, height };

      const vb = parseViewBox(viewBoxAttr);
      if (vb) return vb;

      return fallback;
    }
  } catch {
    // ignore
  }

  // Regex fallback (non-DOM environments)
  const width = parseSvgLengthPx(/\bwidth\s*=\s*['\"]([^'\"]+)['\"]/i.exec(svgText)?.[1]);
  const height = parseSvgLengthPx(/\bheight\s*=\s*['\"]([^'\"]+)['\"]/i.exec(svgText)?.[1]);
  if (width && height) return { width, height };

  const viewBoxAttr = /\bviewBox\s*=\s*['\"]([^'\"]+)['\"]/i.exec(svgText)?.[1];
  return parseViewBox(viewBoxAttr) ?? fallback;
}

export function computeSvgRasterSize(params: {
  intrinsic: SvgDimensions;
  maxWidth?: number;
  maxHeight?: number;
}): SvgDimensions {
  const { intrinsic, maxWidth, maxHeight } = params;

  const MAX_DIMENSION = 8192;

  const w0 = Math.max(1, Number(intrinsic.width) || 1);
  const h0 = Math.max(1, Number(intrinsic.height) || 1);

  const mw =
    Number.isFinite(Number(maxWidth)) && Number(maxWidth) > 0
      ? Math.min(MAX_DIMENSION, Math.max(1, Math.round(Number(maxWidth))))
      : undefined;
  const mh =
    Number.isFinite(Number(maxHeight)) && Number(maxHeight) > 0
      ? Math.min(MAX_DIMENSION, Math.max(1, Math.round(Number(maxHeight))))
      : undefined;

  if (!mw && !mh) {
    return {
      width: Math.min(MAX_DIMENSION, Math.round(w0)),
      height: Math.min(MAX_DIMENSION, Math.round(h0)),
    };
  }

  const scaleW = mw ? mw / w0 : Number.POSITIVE_INFINITY;
  const scaleH = mh ? mh / h0 : Number.POSITIVE_INFINITY;
  const scale = Math.max(1e-6, Math.min(scaleW, scaleH));

  const width = Math.min(MAX_DIMENSION, Math.max(1, Math.round(w0 * scale)));
  const height = Math.min(MAX_DIMENSION, Math.max(1, Math.round(h0 * scale)));
  return { width, height };
}

function parseSvgLengthPx(value: string | null | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  // Support plain numbers, px and common absolute units.
  const match = /^(-?\d*\.?\d+)(px|pt|pc|mm|cm|in)?$/i.exec(trimmed);
  if (!match) return null;
  const raw = Number(match[1]);
  if (!Number.isFinite(raw) || raw <= 0) return null;

  const unit = (match[2] ?? 'px').toLowerCase();
  const pxPerIn = 96;
  switch (unit) {
    case 'px':
      return raw;
    case 'in':
      return raw * pxPerIn;
    case 'cm':
      return (raw * pxPerIn) / 2.54;
    case 'mm':
      return (raw * pxPerIn) / 25.4;
    case 'pt':
      return (raw * pxPerIn) / 72;
    case 'pc':
      return (raw * pxPerIn) / 6;
    default:
      return null;
  }
}

function parseViewBox(viewBox: string | null | undefined): SvgDimensions | null {
  if (!viewBox) return null;
  const parts = viewBox
    .trim()
    .split(/[\s,]+/)
    .map((p) => Number(p));
  if (parts.length !== 4) return null;
  const width = parts[2] ?? Number.NaN;
  const height = parts[3] ?? Number.NaN;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

export async function convertSvgToPng(
  file: File,
  options: SvgRasterizeOptions = {},
): Promise<File> {
  if (
    typeof document === 'undefined' ||
    typeof Image === 'undefined' ||
    typeof URL === 'undefined'
  ) {
    throw new Error('SVG to PNG conversion requires a browser environment');
  }

  const svgText = await file.text();
  const intrinsic = parseSvgDimensions(svgText);
  const { width, height } = computeSvgRasterSize({
    intrinsic,
    maxWidth: options.maxWidth,
    maxHeight: options.maxHeight,
  });

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = 'async';

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width));
      canvas.height = Math.max(1, Math.round(height));

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        return reject(new Error('Failed to create canvas context'));
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
        if (!blob) {
          return reject(new Error('Failed to convert canvas to blob'));
        }

        const pngName = file.name.replace(/\.svg$/i, '.png');
        const pngFile = new File([blob], pngName, {
          type: 'image/png',
          lastModified: file.lastModified,
        });

        resolve(pngFile);
      }, 'image/png');
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load SVG image'));
    };

    img.src = url;
  });
}
