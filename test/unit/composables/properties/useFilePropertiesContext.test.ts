import { ref } from 'vue';
import { describe, expect, it } from 'vitest';
import { useFilePropertiesContext } from '~/composables/properties/useFilePropertiesContext';

const projectVfs = { id: 'project', getFile: () => undefined } as any;
const computerVfsValue = { id: 'computer', getFile: () => undefined } as any;

function build(entry: any, opts: Record<string, any> = {}) {
  return useFilePropertiesContext({
    selectedFsEntry: () => entry,
    isExternal: () => opts.isExternal,
    selectionOrigin: () => opts.selectionOrigin,
    instanceId: () => opts.instanceId,
    computerVfs: ref(opts.computerVfs ?? computerVfsValue),
    fileManagerVfs: () => projectVfs,
  });
}

describe('useFilePropertiesContext', () => {
  it('detects remote file entries', () => {
    const ctx = build({ kind: 'file', name: 'a', path: '/a', source: 'remote' });
    expect(ctx.isRemoteFileEntry.value).toBe(true);
    expect(ctx.metadataCacheKey.value).toBe('external:/a');
  });

  it('uses the raw path as metadata cache key for local files', () => {
    const ctx = build({ kind: 'file', name: 'a', path: 'video/a.mp4' });
    expect(ctx.metadataCacheKey.value).toBe('video/a.mp4');
  });

  it('treats absolute local paths as external context and uses external: prefix for cache key', () => {
    const ctx = build({ kind: 'file', name: 'a', path: '/abs/a.mp4' });
    expect(ctx.isExternalContext.value).toBe(true);
    expect(ctx.metadataCacheKey.value).toBe('external:/abs/a.mp4');
  });

  it('treats workspace-browser / computer instances as external', () => {
    expect(
      build({ kind: 'file', name: 'a', path: 'rel' }, { selectionOrigin: 'workspace-browser' })
        .isExternalContext.value,
    ).toBe(true);
    expect(
      build({ kind: 'file', name: 'a', path: 'rel' }, { instanceId: 'computer' }).isExternalContext
        .value,
    ).toBe(true);
  });

  it('never marks remote entries as external context', () => {
    const ctx = build(
      { kind: 'file', name: 'a', path: '/a', source: 'remote' },
      { isExternal: true },
    );
    expect(ctx.isExternalContext.value).toBe(false);
  });

  it('detects root, workspace-root and common-root directories', () => {
    expect(build({ kind: 'directory', name: 'r', path: '' }).isRootDirectory.value).toBe(true);
    expect(
      build({ kind: 'directory', name: 'r', path: '' }, { instanceId: 'computer' })
        .isWorkspaceRootProperties.value,
    ).toBe(true);
    expect(build({ kind: 'directory', name: 'common', path: 'common' }).isCommonRoot.value).toBe(
      true,
    );
  });

  it('detects the remote root', () => {
    expect(
      build({ kind: 'directory', name: 'r', path: '/remote', source: 'remote' }).isRemoteRoot.value,
    ).toBe(true);
  });

  it('selects the computer VFS in external context, project VFS otherwise', () => {
    const external = build({ kind: 'file', name: 'a', path: '/abs/a' });
    expect((external.effectiveVfs.value as { id: string }).id).toBe('computer');

    const local = build({ kind: 'file', name: 'a', path: 'rel' });
    expect((local.effectiveVfs.value as { id: string }).id).toBe('project');
  });
});
