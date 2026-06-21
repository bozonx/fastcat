import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useBloggerDogStore } from '~/stores/bloggerdog';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';

mockNuxtImport('useRuntimeConfig', () => {
  return () => ({
    public: {
      bloggerDogApiUrl: 'https://default-bd-api.test',
      fastcatAccountApiUrl: 'https://acc-api.test',
    },
    app: {
      baseURL: '/',
    },
  });
});

const { workspaceMock, remoteVfsMock, externalIntegrationsMock } = vi.hoisted(() => {
  const workspaceMock = {
    userSettings: {
      integrations: {
        files: {
          activeIntegrationId: 'bloggerdog',
          configs: {
            bloggerdog: {
              baseUrl: 'https://api.bloggerdog.test',
              bearerToken: 'test-token',
            },
          },
        },
      },
    },
  };

  const remoteVfsMock = {
    createRemoteCollection: vi.fn(),
    createRemoteItem: vi.fn(),
    updateRemoteItem: vi.fn(),
    deleteRemoteCollection: vi.fn(),
    deleteRemoteItem: vi.fn(),
    fetchRemoteCollections: vi.fn(),
    fetchRemoteItems: vi.fn(),
    getRemoteThumbnailUrl: vi.fn(),
    renameRemoteCollection: vi.fn(),
    renameRemoteItem: vi.fn(),
  };

  const externalIntegrationsMock = {
    resolveExternalServiceConfig: vi.fn(),
  };

  return {
    workspaceMock,
    remoteVfsMock,
    externalIntegrationsMock,
  };
});

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(() => workspaceMock),
}));

vi.mock('~/utils/external-integrations', () => externalIntegrationsMock);

vi.mock('~/utils/remote-vfs', () => remoteVfsMock);

import { resolveExternalServiceConfig } from '~/utils/external-integrations';
import {
  createRemoteCollection,
  createRemoteItem,
  updateRemoteItem,
  deleteRemoteCollection,
  deleteRemoteItem,
  fetchRemoteCollections,
  fetchRemoteItems,
  getRemoteThumbnailUrl,
  renameRemoteCollection,
  renameRemoteItem,
} from '~/utils/remote-vfs';

describe('bloggerdog.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('config', () => {
    it('returns config when resolveExternalServiceConfig succeeds', () => {
      externalIntegrationsMock.resolveExternalServiceConfig.mockReturnValue({
        baseUrl: 'https://resolved.api.test',
        bearerToken: 'resolved-token',
      });

      const store = useBloggerDogStore();
      expect(store.config).toEqual({
        baseUrl: 'https://resolved.api.test',
        bearerToken: 'resolved-token',
      });
      expect(externalIntegrationsMock.resolveExternalServiceConfig).toHaveBeenCalledWith({
        service: 'files',
        integrations: workspaceMock.userSettings.integrations,
        bloggerDogApiUrl: 'https://default-bd-api.test',
        fastcatAccountApiUrl: 'https://acc-api.test',
      });
    });

    it('returns null when resolveExternalServiceConfig returns null or throws', () => {
      externalIntegrationsMock.resolveExternalServiceConfig.mockReturnValue(null);
      let store = useBloggerDogStore();
      expect(store.config).toBeNull();

      // Reset Pinia to bypass computed caching
      setActivePinia(createPinia());
      externalIntegrationsMock.resolveExternalServiceConfig.mockImplementation(() => {
        throw new Error('fail');
      });
      store = useBloggerDogStore();
      expect(store.config).toBeNull();
    });
  });

  describe('loadEntries', () => {
    it('does nothing if config is null', async () => {
      externalIntegrationsMock.resolveExternalServiceConfig.mockReturnValue(null);
      const store = useBloggerDogStore();
      await store.loadEntries();
      expect(remoteVfsMock.fetchRemoteCollections).not.toHaveBeenCalled();
    });

    it('loads collections and items on success', async () => {
      externalIntegrationsMock.resolveExternalServiceConfig.mockReturnValue({
        baseUrl: 'https://api.test',
        bearerToken: 'token',
      });

      const mockCollections = [{ id: 'col1', type: 'directory', name: 'Col 1' }];
      const mockItems = {
        items: [{ id: 'item1', type: 'file', name: 'Item 1' }],
        total: 10,
      };

      remoteVfsMock.fetchRemoteCollections.mockResolvedValue(mockCollections as any);
      remoteVfsMock.fetchRemoteItems.mockResolvedValue(mockItems as any);

      const store = useBloggerDogStore();
      await store.loadEntries({
        scope: 'personal',
        projectId: 'p1',
        groupId: 'g1',
        orphansOnly: true,
        limit: 10,
        offset: 0,
        sortBy: 'name',
        sortOrder: 'asc',
      });

      expect(store.entries).toEqual([...mockCollections, ...mockItems.items]);
      expect(store.totalEntries).toBe(11);
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();

      expect(remoteVfsMock.fetchRemoteCollections).toHaveBeenCalledWith({
        config: { baseUrl: 'https://api.test', bearerToken: 'token' },
        scope: 'personal',
        projectId: 'p1',
        parentId: 'g1',
        orphansOnly: true,
        includeChildrenCount: true,
      });

      expect(remoteVfsMock.fetchRemoteItems).toHaveBeenCalledWith({
        config: { baseUrl: 'https://api.test', bearerToken: 'token' },
        scope: 'personal',
        projectId: 'p1',
        groupId: 'g1',
        orphansOnly: true,
        limit: 10,
        offset: 0,
        sortBy: 'name',
        sortOrder: 'asc',
      });
    });

    it('sets error message on failure', async () => {
      externalIntegrationsMock.resolveExternalServiceConfig.mockReturnValue({
        baseUrl: 'https://api.test',
        bearerToken: 'token',
      });
      remoteVfsMock.fetchRemoteCollections.mockRejectedValue(new Error('Network Error'));

      const store = useBloggerDogStore();
      await store.loadEntries();

      expect(store.error).toBe('Network Error');
      expect(store.isLoading).toBe(false);
    });
  });

  describe('getThumbnailUrl', () => {
    it('returns null if config is null or entry is not a file or has no media', () => {
      externalIntegrationsMock.resolveExternalServiceConfig.mockReturnValue(null);
      const store = useBloggerDogStore();
      expect(store.getThumbnailUrl({ id: '1', type: 'file' } as any)).toBeNull();

      externalIntegrationsMock.resolveExternalServiceConfig.mockReturnValue({ baseUrl: 'x', bearerToken: 'y' });
      expect(store.getThumbnailUrl({ id: '1', type: 'directory' } as any)).toBeNull();
      expect(store.getThumbnailUrl({ id: '1', type: 'file', media: [] } as any)).toBeNull();
    });

    it('returns thumbnail url using active config', () => {
      externalIntegrationsMock.resolveExternalServiceConfig.mockReturnValue({
        baseUrl: 'https://api.test',
        bearerToken: 'token',
      });
      remoteVfsMock.getRemoteThumbnailUrl.mockReturnValue('https://api.test/thumb.png');

      const store = useBloggerDogStore();
      const entry = {
        id: '1',
        type: 'file',
        media: [{ thumbnailUrl: 'http://xyz' }],
      };
      
      const thumb = store.getThumbnailUrl(entry as any);
      expect(thumb).toBe('https://api.test/thumb.png');
      expect(remoteVfsMock.getRemoteThumbnailUrl).toHaveBeenCalledWith({
        baseUrl: 'https://api.test',
        media: entry.media[0],
      });
    });
  });

  describe('remote operations wrappers', () => {
    beforeEach(() => {
      externalIntegrationsMock.resolveExternalServiceConfig.mockReturnValue({
        baseUrl: 'https://api.test',
        bearerToken: 'token',
      });
    });

    it('wraps createCollection', async () => {
      const store = useBloggerDogStore();
      await store.createCollection({ name: 'Folder', scope: 'personal', projectId: 'p1', parentId: 'parent1' });
      expect(remoteVfsMock.createRemoteCollection).toHaveBeenCalledWith({
        config: { baseUrl: 'https://api.test', bearerToken: 'token' },
        name: 'Folder',
        scope: 'personal',
        projectId: 'p1',
        parentId: 'parent1',
      });
    });

    it('wraps createItem', async () => {
      const store = useBloggerDogStore();
      await store.createItem({ title: 'Note', scope: 'personal' });
      expect(remoteVfsMock.createRemoteItem).toHaveBeenCalledWith({
        config: { baseUrl: 'https://api.test', bearerToken: 'token' },
        title: 'Note',
        scope: 'personal',
      });
    });

    it('wraps updateItem', async () => {
      const store = useBloggerDogStore();
      await store.updateItem({ id: 'item1', title: 'New Title' });
      expect(remoteVfsMock.updateRemoteItem).toHaveBeenCalledWith({
        config: { baseUrl: 'https://api.test', bearerToken: 'token' },
        id: 'item1',
        title: 'New Title',
      });
    });

    it('wraps renameEntry', async () => {
      const store = useBloggerDogStore();
      await store.renameEntry('1', 'directory', 'New Name');
      expect(remoteVfsMock.renameRemoteCollection).toHaveBeenCalledWith({
        config: { baseUrl: 'https://api.test', bearerToken: 'token' },
        id: '1',
        name: 'New Name',
      });

      await store.renameEntry('2', 'file', 'New File');
      expect(remoteVfsMock.renameRemoteItem).toHaveBeenCalledWith({
        config: { baseUrl: 'https://api.test', bearerToken: 'token' },
        id: '2',
        name: 'New File',
      });
    });

    it('wraps deleteEntry', async () => {
      const store = useBloggerDogStore();
      await store.deleteEntry('1', 'directory');
      expect(remoteVfsMock.deleteRemoteCollection).toHaveBeenCalledWith({
        config: { baseUrl: 'https://api.test', bearerToken: 'token' },
        id: '1',
      });

      await store.deleteEntry('2', 'file');
      expect(remoteVfsMock.deleteRemoteItem).toHaveBeenCalledWith({
        config: { baseUrl: 'https://api.test', bearerToken: 'token' },
        id: '2',
      });
    });
  });
});
