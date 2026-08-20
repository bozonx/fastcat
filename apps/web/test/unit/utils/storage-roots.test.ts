/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  FASTCAT_CONFIG_DIR_NAME,
  FASTCAT_CONTENT_ROOT_DIR_NAME,
  PROJECTS_ROOT_DIR_NAME,
  getWorkspaceStorageTopology,
} from '~/utils/storage-roots';

describe('storage-roots', () => {
  it('exports expected directory constants', () => {
    expect(FASTCAT_CONFIG_DIR_NAME).toBe('.fastcat-config');
    expect(FASTCAT_CONTENT_ROOT_DIR_NAME).toBe('FastCat');
    expect(PROJECTS_ROOT_DIR_NAME).toBe('projects');
  });

  it('returns workspace topology', () => {
    const topology = getWorkspaceStorageTopology();
    expect(topology.projectsDirName).toBe('projects');
    expect(topology.commonDirName).toBe('common');
    expect(topology.configDirName).toBe('.fastcat-config');
  });
});
