import { describe, expect, it } from 'vitest';
import {
  getResolvedProjectCacheSegments,
  getResolvedProjectProxiesSegments,
  getResolvedProjectTempSegments,
  getResolvedProjectWaveformsSegments,
  resolveWorkspaceLocalStorageTopology,
} from '~/utils/storage-topology';

describe('storage topology', () => {
  it('resolves workspace-local topology with defaults', () => {
    const resolved = resolveWorkspaceLocalStorageTopology({
      contentRootPath: '',
      dataRootPath: '',
      tempRootPath: '',
      proxiesRootPath: '',
      ephemeralTmpRootPath: '',
      placementMode: 'system-default',
    });

    expect(resolved.projectsRoot).toBe('projects');
    expect(resolved.commonRoot).toBe('common');
    expect(resolved.dataRoot).toBe('data');
    expect(resolved.tempRoot).toBe('vardata');
    expect(resolved.proxiesRoot).toBe('');
    expect(resolved.ephemeralTmpRoot).toBe('');
  });

  it('resolves workspace-local topology with custom overrides', () => {
    const resolved = resolveWorkspaceLocalStorageTopology({
      contentRootPath: '  content-root  ',
      dataRootPath: '  custom-data  ',
      tempRootPath: '  custom-temp  ',
      proxiesRootPath: '  custom-proxies  ',
      ephemeralTmpRootPath: '  custom-ephemeral  ',
      placementMode: 'portable',
    });

    expect(resolved.projectsRoot).toBe('content-root/projects');
    expect(resolved.commonRoot).toBe('content-root/common');
    expect(resolved.dataRoot).toBe('custom-data/data');
    expect(resolved.tempRoot).toBe('custom-temp');
    expect(resolved.proxiesRoot).toBe('custom-proxies');
    expect(resolved.ephemeralTmpRoot).toBe('custom-ephemeral');
  });

  it('builds derived runtime segments from resolved topology', () => {
    const resolved = resolveWorkspaceLocalStorageTopology({
      contentRootPath: '',
      dataRootPath: '',
      tempRootPath: 'custom-temp-root',
      proxiesRootPath: 'custom-proxies-root',
      ephemeralTmpRootPath: 'system-tmp',
      placementMode: 'portable',
    });

    expect(getResolvedProjectTempSegments(resolved, 'project-1')).toEqual([
      'custom-temp-root',
      'projects',
      'project-1',
    ]);
    expect(getResolvedProjectProxiesSegments(resolved, 'project-1')).toEqual([
      'custom-proxies-root',
      'project-1',
    ]);
    expect(getResolvedProjectCacheSegments(resolved, 'project-1')).toEqual([
      'custom-temp-root',
      'projects',
      'project-1',
      'frame-cache',
    ]);
    expect(getResolvedProjectWaveformsSegments(resolved, 'project-1')).toEqual([
      'custom-temp-root',
      'projects',
      'project-1',
      'waveforms',
    ]);
  });
});
