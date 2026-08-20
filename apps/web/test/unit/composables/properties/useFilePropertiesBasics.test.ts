import { describe, it, expect } from 'vitest';
import { ref } from 'vue';
import { useFilePropertiesBasics } from '~/composables/properties/useFilePropertiesBasics';

describe('useFilePropertiesBasics', () => {
  it('detects hidden entries by name', () => {
    const api = useFilePropertiesBasics({
      selectedFsEntry: ref({ name: '.hidden', path: '/.hidden' }),
      fileInfo: ref(null),
      isOtio: ref(false),
      mediaType: ref('image'),
    });

    expect(api.isHidden.value).toBe(true);
  });

  it('extracts extension lowercased', () => {
    const api = useFilePropertiesBasics({
      selectedFsEntry: ref({ name: 'Movie.MP4', path: '/Movie.MP4' }),
      fileInfo: ref(null),
      isOtio: ref(false),
      mediaType: ref('video'),
    });

    expect(api.ext.value).toBe('mp4');
  });

  it('computes generalInfoTitle', () => {
    const api1 = useFilePropertiesBasics({
      selectedFsEntry: ref({}),
      fileInfo: ref({ kind: 'directory' }),
      isOtio: ref(false),
      mediaType: ref(null),
    });
    expect(api1.generalInfoTitle.value).toBe('common.folder');

    const api2 = useFilePropertiesBasics({
      selectedFsEntry: ref({}),
      fileInfo: ref({ kind: 'file', mimeType: 'video/mp4' }),
      isOtio: ref(true),
      mediaType: ref('video'),
    });
    expect(api2.generalInfoTitle.value).toBe('OTIO');
  });
});
