export interface SvgDimensions {
  width: number;
  height: number;
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
  const width = parts[2];
  const height = parts[3];
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

export async function convertSvgToPng(file: File): Promise<File> {
  if (
    typeof document === 'undefined' ||
    typeof Image === 'undefined' ||
    typeof URL === 'undefined'
  ) {
    throw new Error('SVG to PNG conversion requires a browser environment');
  }

  const svgText = await file.text();
  const { width, height } = parseSvgDimensions(svgText);

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
