export interface MediaDimensions {
  width: number;
  height: number;
}

export interface ProjectFormatOptions {
  width: number;
  height: number;
  orientation: 'landscape' | 'portrait';
  aspectRatio: string;
  resolutionFormat: string;
}

export function getMediaDimensions(file: File): Promise<MediaDimensions> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      resolve({ width: 1920, height: 1080 });
      return;
    }

    const url = URL.createObjectURL(file);
    if (file.type.startsWith('video/')) {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      video.src = url;

      const cleanUp = () => {
        URL.revokeObjectURL(url);
        video.removeAttribute('src');
        video.load();
      };

      video.onloadedmetadata = () => {
        const width = video.videoWidth;
        const height = video.videoHeight;
        cleanUp();
        if (width && height) {
          resolve({ width, height });
        } else {
          reject(new Error('Invalid video dimensions'));
        }
      };

      video.onerror = () => {
        cleanUp();
        reject(new Error('Failed to load video metadata'));
      };
    } else if (file.type.startsWith('image/')) {
      const img = new Image();
      img.src = url;

      const cleanUp = () => {
        URL.revokeObjectURL(url);
      };

      img.onload = () => {
        const width = img.naturalWidth;
        const height = img.naturalHeight;
        cleanUp();
        if (width && height) {
          resolve({ width, height });
        } else {
          reject(new Error('Invalid image dimensions'));
        }
      };

      img.onerror = () => {
        cleanUp();
        reject(new Error('Failed to load image'));
      };
    } else {
      resolve({ width: 1920, height: 1080 });
    }
  });
}

export function detectProjectFormat(width: number, height: number): ProjectFormatOptions {
  const isPortrait = height > width;

  const longSide = Math.max(width, height);
  const shortSide = Math.min(width, height);
  const ratio = longSide / shortSide;

  interface Aspect {
    value: string;
    ratio: number;
  }

  const aspects: Aspect[] = [
    { value: '16:9', ratio: 16 / 9 },
    { value: '4:3', ratio: 4 / 3 },
    { value: '1:1', ratio: 1 },
    { value: '21:9', ratio: 21 / 9 },
  ];

  let bestAspect: Aspect = aspects[0]!;
  let minDiff = Math.abs(ratio - bestAspect.ratio);

  for (const aspect of aspects) {
    const diff = Math.abs(ratio - aspect.ratio);
    if (diff < minDiff) {
      minDiff = diff;
      bestAspect = aspect;
    }
  }

  let resolutionFormat = '1080p';
  if (shortSide >= 2160) {
    resolutionFormat = '4k';
  } else if (shortSide >= 1440) {
    resolutionFormat = '2.7k';
  } else if (shortSide >= 1080) {
    resolutionFormat = '1080p';
  } else if (shortSide >= 720) {
    resolutionFormat = '720p';
  } else {
    resolutionFormat = '480p';
  }

  const bases: Record<string, number> = {
    '480p': 480,
    '720p': 720,
    '1080p': 1080,
    '2.7k': 1440,
    '4k': 2160,
  };
  const base = bases[resolutionFormat] || 1080;
  const targetRatio = bestAspect.ratio;

  let finalWidth = 0;
  let finalHeight = 0;
  const orientation: 'landscape' | 'portrait' = isPortrait ? 'portrait' : 'landscape';

  if (orientation === 'landscape') {
    finalHeight = base;
    finalWidth = Math.round(base * targetRatio);
  } else {
    finalWidth = base;
    finalHeight = Math.round(base * targetRatio);
  }

  finalWidth = Math.round(finalWidth / 2) * 2;
  finalHeight = Math.round(finalHeight / 2) * 2;

  return {
    width: finalWidth,
    height: finalHeight,
    orientation,
    aspectRatio: bestAspect.value,
    resolutionFormat,
  };
}

export async function tryDetectMediaDimensions(files: File[]): Promise<ProjectFormatOptions | null> {
  const mediaFile = files.find((f) => f.type.startsWith('video/') || f.type.startsWith('image/'));
  if (!mediaFile) return null;

  try {
    const dimensions = await getMediaDimensions(mediaFile);
    return detectProjectFormat(dimensions.width, dimensions.height);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('Failed to detect media dimensions, using defaults:', e);
    return null;
  }
}
