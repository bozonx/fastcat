import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { mountWithNuxt } from '../../utils/mount';

import FileProperties from '~/components/properties/FileProperties.vue';

vi.mock('~/stores/timeline-media-usage.store', () => ({
  useTimelineMediaUsageStore: () => ({
    mediaPathToTimelines: {},
    setLiveUsage: vi.fn(),
  }),
}));

vi.mock('~/composables/file-manager/useEntryPreview', () => {
  return {
    useEntryPreview: () => {
      return {
        currentUrl: ref(null),
        mediaType: ref('image'),
        textContent: ref(''),
        fileInfo: ref({
          kind: 'file',
          name: 'image.jpg',
          size: 123,
          lastModified: Date.now(),
          mimeType: 'image/jpeg',
          ext: 'jpg',
        }),
        timelineDocSummary: ref(null),
        exifData: ref({
          ExifImageWidth: 1920,
          ExifImageHeight: 1080,
          CreateDate: '2020:01:02 03:04:05',
          Make: 'TestCamera',
          latitude: 12.34,
          longitude: 56.78,
        }),
        exifYaml: ref('Make: TestCamera\nModel: UnitTest\n'),
        imageDimensions: ref({ width: 1920, height: 1080 }),
        metadataYaml: ref(null),
        isUnknown: ref(false),
        isOtio: ref(false),
      };
    },
  };
});

describe('FileProperties EXIF', () => {
  it('renders EXIF section collapsed by default and shows YAML on expand', async () => {
    const component = await mountWithNuxt(FileProperties, {
      props: {
        selectedFsEntry: { kind: 'file', name: 'image.jpg', handle: {} },
        previewMode: 'original',
        hasProxy: false,
      },
    });

    expect(component.text()).toContain('EXIF');
    expect(component.text()).toContain('Resolution');
    expect(component.text()).toContain('1920x1080');
    expect(component.text()).toContain('CreateDate');
    expect(component.text()).toContain('2020:01:02 03:04:05');
    expect(component.text()).toContain('Camera');
    expect(component.text()).toContain('TestCamera');
    expect(component.text()).toContain('Location');

    const mapsLink = component.find('a[href^="https://www.google.com/maps?q="]');
    expect(mapsLink.exists()).toBe(true);

    expect(component.text()).toContain('Show');
    expect(component.text()).not.toContain('Make: TestCamera');

    const buttons = component.findAll('button');
    const showButton = buttons.find((b) => b.text().includes('Show'));
    expect(showButton).toBeTruthy();

    await showButton!.trigger('click');

    expect(component.text()).toContain('Hide');
    expect(component.text()).toContain('Make: TestCamera');
  });
});
