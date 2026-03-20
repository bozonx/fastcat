import { describe, it, expect } from 'vitest';
import { ref } from 'vue';
import { useFileStorageInfo } from '~/composables/properties/useFileStorageInfo';

describe('useFileStorageInfo', () => {
  it('identifies project root dir when name matches and path is empty', () => {
    const currentProjectName = ref('my-project');
    const selectedFsEntry = ref({
      kind: 'directory',
      name: 'my-project',
      path: '',
    });

    const api = useFileStorageInfo({
      selectedFsEntry,
      currentProjectName,
    });

    expect(api.isProjectRootDir.value).toBe(true);

    selectedFsEntry.value.path = '/something';
    expect(api.isProjectRootDir.value).toBe(false);
  });
});
