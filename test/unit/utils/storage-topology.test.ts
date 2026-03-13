import { describe, expect, it } from 'vitest';
import {
  getResolvedProjectCacheSegments,
  getResolvedProjectProxiesSegments,
  getResolvedProjectTempSegments,
  getResolvedProjectWaveformsSegments,
  resolveWorkspaceLocalStorageTopology,
} from '../../../src/utils/storage-topology';

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

  it('builds derived runtime segments from resolved topology', () => {
    const resolved = resolveWorkspaceLocalStorageTopology({
      contentRootPath: '',
      dataRootPath: '',
      tempRootPath: 'custom-temp-root',
      proxiesRootPath: 'custom-proxies-root',
      placementMode: 'portable',
    });

    expect(getResolvedProjectTempSegments(resolved, 'project-1')).toEqual([
      'custom-temp-root',
      'project-1',
    ]);
    expect(getResolvedProjectProxiesSegments(resolved, 'project-1')).toEqual([
      'custom-proxies-root',
      'project-1',
    ]);
    expect(getResolvedProjectCacheSegments(resolved, 'project-1')).toEqual([
      'custom-temp-root',
      'project-1',
      'cache',
    ]);
    expect(getResolvedProjectWaveformsSegments(resolved, 'project-1')).toEqual([
      'custom-temp-root',
      'project-1',
      'cache',
      'waveforms',
    ]);
  });
});
