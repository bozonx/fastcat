import { computed, type Ref } from 'vue';

interface ImageDimensions {
  width: number;
  height: number;
}

interface UseImageExifInfoOptions {
  mediaType: Ref<string | null | undefined>;
  exifData: Ref<unknown>;
  imageDimensions: Ref<ImageDimensions | null | undefined>;
}

export function useImageExifInfo(options: UseImageExifInfoOptions) {
  const imageResolution = computed(() => {
    if (options.mediaType.value !== 'image') return null;
    const exif = options.exifData.value as any;
    const width =
      exif?.ExifImageWidth ??
      exif?.ImageWidth ??
      exif?.PixelXDimension ??
      exif?.SourceImageWidth ??
      options.imageDimensions.value?.width ??
      null;
    const height =
      exif?.ExifImageHeight ??
      exif?.ImageHeight ??
      exif?.PixelYDimension ??
      exif?.SourceImageHeight ??
      options.imageDimensions.value?.height ??
      null;

    if (typeof width === 'number' && typeof height === 'number') return `${width}x${height}`;
    return null;
  });

  const imageCreateDate = computed(() => {
    if (options.mediaType.value !== 'image') return null;
    const exif = options.exifData.value as any;
    if (!exif) return null;

    const date: unknown = exif.CreateDate ?? exif.DateTimeOriginal ?? exif.ModifyDate ?? null;
    if (!date) return null;
    if (date instanceof Date) return date.toLocaleString();
    if (typeof date === 'string') return date;
    return null;
  });

  const imageCameraMake = computed(() => {
    if (options.mediaType.value !== 'image') return null;
    const exif = options.exifData.value as any;
    if (!exif) return null;
    return typeof exif.Make === 'string' && exif.Make.trim().length > 0 ? exif.Make : null;
  });

  const imageLocationLink = computed(() => {
    if (options.mediaType.value !== 'image') return null;
    const exif = options.exifData.value as any;
    if (!exif) return null;

    const lat = exif.latitude ?? exif.Latitude ?? exif.GPSLatitude ?? null;
    const lng = exif.longitude ?? exif.Longitude ?? exif.GPSLongitude ?? null;
    if (typeof lat !== 'number' || typeof lng !== 'number') return null;

    return `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}`;
  });

  const hasImageInfo = computed(() => {
    return Boolean(
      imageResolution.value || imageCreateDate.value || imageLocationLink.value || imageCameraMake.value,
    );
  });

  return {
    hasImageInfo,
    imageCameraMake,
    imageCreateDate,
    imageLocationLink,
    imageResolution,
  };
}
