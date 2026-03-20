import { describe, it, expect } from 'vitest';
import { ref } from 'vue';
import { useImageExifInfo } from '~/composables/properties/useImageExifInfo';

describe('useImageExifInfo', () => {
  it('returns resolution from imageDimensions when exif is missing', () => {
    const api = useImageExifInfo({
      mediaType: ref('image'),
      exifData: ref(null),
      imageDimensions: ref({ width: 1920, height: 1080 }),
    });

    expect(api.imageResolution.value).toBe('1920x1080');
    expect(api.hasImageInfo.value).toBe(true);
  });

  it('returns google maps link when GPS coords exist', () => {
    const api = useImageExifInfo({
      mediaType: ref('image'),
      exifData: ref({ GPSLatitude: 10.5, GPSLongitude: 20.25 }),
      imageDimensions: ref(null),
    });

    expect(api.imageLocationLink.value).toBe('https://www.google.com/maps?q=10.5%2C20.25');
    expect(api.hasImageInfo.value).toBe(true);
  });

  it('returns nulls when mediaType is not image', () => {
    const api = useImageExifInfo({
      mediaType: ref('video'),
      exifData: ref({ ExifImageWidth: 1, ExifImageHeight: 2 }),
      imageDimensions: ref({ width: 10, height: 20 }),
    });

    expect(api.imageResolution.value).toBeNull();
    expect(api.imageCreateDate.value).toBeNull();
    expect(api.imageCameraMake.value).toBeNull();
    expect(api.imageLocationLink.value).toBeNull();
    expect(api.hasImageInfo.value).toBe(false);
  });
});
