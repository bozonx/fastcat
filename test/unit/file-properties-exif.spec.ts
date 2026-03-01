import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { mountWithNuxt } from '../utils/mount';

vi.mock('~/composables/fileManager/useEntryPreview', () => {
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
        exifYaml: ref('Make: TestCamera\nModel: UnitTest\n'),
        metadataYaml: ref(null),
        isUnknown: ref(false),
        isOtio: ref(false),
      };
    },
  };
});

import FileProperties from '../../src/components/properties/FileProperties.vue';

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
