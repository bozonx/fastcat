import { describe, expect, it } from 'vitest';
import { resolveWorkspaceLocalStorageTopology } from '../../../src/utils/storage-topology';

describe('storage topology', () => {
  it('resolves workspace-local topology with defaults', () => {
    const resolved = resolveWorkspaceLocalStorageTopology({
      contentRootPath: '',
      dataRootPath: '',
      tempRootPath: '',
      proxiesRootPath: '',
      placementMode: 'system-default',
    });

    expect(resolved.projectsRoot).toBe('projects');
    expect(resolved.commonRoot).toBe('common');
    expect(resolved.dataRoot).toBe('data');
    expect(resolved.tempRoot).toBe('vardata');
    expect(resolved.proxiesRoot).toBe('vardata/proxies');
  });

  it('resolves workspace-local topology with custom overrides', () => {
    const resolved = resolveWorkspaceLocalStorageTopology({
      contentRootPath: '  content-root  ',
      dataRootPath: '  custom-data  ',
      tempRootPath: '  custom-temp  ',
      proxiesRootPath: '  custom-proxies  ',
      placementMode: 'portable',
    });

    expect(resolved.projectsRoot).toBe('content-root/projects');
    expect(resolved.commonRoot).toBe('content-root/common');
    expect(resolved.dataRoot).toBe('custom-data/data');
    expect(resolved.tempRoot).toBe('custom-temp');
    expect(resolved.proxiesRoot).toBe('custom-proxies');
  });
});
