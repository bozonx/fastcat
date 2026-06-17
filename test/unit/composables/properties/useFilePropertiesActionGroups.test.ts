import { ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { useFilePropertiesActionGroups } from '~/composables/properties/useFilePropertiesActionGroups';

function dir(id: string): any {
  return { id, label: id, icon: 'i', onClick: vi.fn() };
}

function build(overrides: Record<string, any> = {}) {
  const deps = {
    directoryPrimaryActions: ref([dir('paste'), dir('createSubgroup'), dir('createContentItem')]),
    directorySecondaryActions: ref([dir('createContentItem'), dir('createSubgroup'), dir('other')]),
    filePrimaryActions: ref([dir('copy'), dir('cut'), dir('delete'), dir('rename')]),
    fileSecondaryActions: ref([dir('openAsPanelCut'), dir('openAsProjectTab'), dir('reveal')]),
    isPersonalLibrary: ref(false),
    isRemoteContent: ref(false),
    isRemoteFileEntry: ref(false),
    isExternalContext: ref(false),
    isMobile: ref(false),
    hasClipboardItems: ref(true),
    selectedFsEntry: () => ({ kind: 'file', name: 'a.txt', path: '/a.txt' }) as any,
    onPaste: vi.fn(),
    createSubfolder: vi.fn(),
    createMarkdownInFolder: vi.fn(),
    t: (k: string) => k,
    ...overrides,
  };
  return { deps, groups: useFilePropertiesActionGroups(deps) };
}

describe('useFilePropertiesActionGroups', () => {
  describe('filteredDirectoryPrimaryActions', () => {
    it('drops bloggerDog-only actions for local directories', () => {
      const { groups } = build();
      expect(groups.filteredDirectoryPrimaryActions.value.map((a) => a.id)).toEqual(['paste']);
    });

    it('keeps all actions for remote content', () => {
      const { groups } = build({ isRemoteContent: ref(true) });
      expect(groups.filteredDirectoryPrimaryActions.value.map((a) => a.id)).toEqual([
        'paste',
        'createSubgroup',
        'createContentItem',
      ]);
    });

    it('returns nothing for the personal library', () => {
      const { groups } = build({ isPersonalLibrary: ref(true) });
      expect(groups.filteredDirectoryPrimaryActions.value).toEqual([]);
    });
  });

  describe('filteredFilePrimaryActions', () => {
    it('limits a bloggerDog text wrapper to copy only', () => {
      const { groups } = build({
        selectedFsEntry: () =>
          ({
            kind: 'file',
            name: 'x.txt',
            path: '/p',
            source: 'remote',
            adapterPayload: { type: 'media', remoteData: { type: 'file', text: 'hi' } },
          }) as any,
      });
      expect(groups.filteredFilePrimaryActions.value.map((a) => a.id)).toEqual(['copy']);
    });

    it('passes through file actions for regular files', () => {
      const { groups } = build();
      expect(groups.filteredFilePrimaryActions.value.map((a) => a.id)).toEqual([
        'copy',
        'cut',
        'delete',
        'rename',
      ]);
    });
  });

  describe('filteredFileSecondaryActions', () => {
    it('returns nothing for remote file entries', () => {
      const { groups } = build({ isRemoteFileEntry: ref(true) });
      expect(groups.filteredFileSecondaryActions.value).toEqual([]);
    });

    it('strips open-as actions in external context', () => {
      const { groups } = build({ isExternalContext: ref(true) });
      expect(groups.filteredFileSecondaryActions.value.map((a) => a.id)).toEqual(['reveal']);
    });

    it('keeps all secondary actions in project context', () => {
      const { groups } = build();
      expect(groups.filteredFileSecondaryActions.value.map((a) => a.id)).toEqual([
        'openAsPanelCut',
        'openAsProjectTab',
        'reveal',
      ]);
    });

    it('strips open-as actions on mobile', () => {
      const { groups } = build({ isMobile: ref(true) });
      expect(groups.filteredFileSecondaryActions.value.map((a) => a.id)).toEqual(['reveal']);
    });
  });

  describe('scoped group filters', () => {
    it('virtualAll exposes only paste + createContentItem', () => {
      const { groups } = build();
      expect(groups.virtualAllPrimaryActions.value.map((a) => a.id)).toEqual(['paste']);
      expect(groups.virtualAllSecondaryActions.value.map((a) => a.id)).toEqual([
        'createContentItem',
      ]);
    });

    it('personalLibrary/project expose paste + create group/item', () => {
      const { groups } = build();
      expect(groups.personalLibrarySecondaryActions.value.map((a) => a.id)).toEqual([
        'createContentItem',
        'createSubgroup',
      ]);
      expect(groups.projectSecondaryActions.value.map((a) => a.id)).toEqual([
        'createContentItem',
        'createSubgroup',
      ]);
    });
  });

  describe('workspaceRoot actions', () => {
    it('builds a paste action disabled when the clipboard is empty', () => {
      const { groups } = build({ hasClipboardItems: ref(false) });
      const paste = groups.workspaceRootPrimaryActions.value[0];
      expect(paste?.id).toBe('paste');
      expect(paste?.disabled).toBe(true);
    });

    it('wires create folder/markdown handlers', () => {
      const { deps, groups } = build();
      const ids = groups.workspaceRootSecondaryActions.value.map((a) => a.id);
      expect(ids).toEqual(['createSubfolder', 'createMarkdown']);
      groups.workspaceRootSecondaryActions.value[0]!.onClick?.();
      expect(deps.createSubfolder).toHaveBeenCalled();
    });
  });
});
