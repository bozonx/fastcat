/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { ref, computed } from 'vue';
import { createTimelineExternalRefsModule } from '~/stores/timeline/external-refs';

describe('createTimelineExternalRefsModule', () => {
  it('creates refs that read from the project store', () => {
    const projectStore = {
      currentProjectName: 'My Project',
      currentTimelinePath: '/path/timeline.otio',
    };
    const mediaStore = {
      mediaMetadata: { '/path/video.mp4': { duration: 10 } },
    };
    const mod = createTimelineExternalRefsModule({ projectStore, mediaStore });

    expect(mod.currentProjectName.value).toBe('My Project');
    expect(mod.currentTimelinePath.value).toBe('/path/timeline.otio');
    expect(mod.mediaMetadata.value).toEqual({ '/path/video.mp4': { duration: 10 } });
  });

  it('creates writable refs that update the store', () => {
    const projectStore: Record<string, unknown> = {
      currentProjectName: 'Old',
      currentTimelinePath: '/old.otio',
    };
    const mediaStore: Record<string, unknown> = {
      mediaMetadata: {},
    };
    const mod = createTimelineExternalRefsModule({ projectStore, mediaStore });

    mod.currentProjectName.value = 'New';
    expect(projectStore.currentProjectName).toBe('New');

    mod.currentTimelinePath.value = '/new.otio';
    expect(projectStore.currentTimelinePath).toBe('/new.otio');

    const newMeta = { '/path/clip.mp4': { duration: 5 } };
    mod.mediaMetadata.value = newMeta;
    expect(mediaStore.mediaMetadata).toBe(newMeta);
  });

  it('returns fallback values when store properties are missing', () => {
    const projectStore = {};
    const mediaStore = {};
    const mod = createTimelineExternalRefsModule({ projectStore, mediaStore });

    expect(mod.currentProjectName.value).toBeNull();
    expect(mod.currentTimelinePath.value).toBeNull();
    expect(mod.mediaMetadata.value).toEqual({});
  });

  it('write is no-op when store property does not exist', () => {
    const projectStore: Record<string, unknown> = {};
    const mediaStore: Record<string, unknown> = {};
    const mod = createTimelineExternalRefsModule({ projectStore, mediaStore });

    mod.currentProjectName.value = 'Test';
    // Should not add the property to the store
    expect('currentProjectName' in projectStore).toBe(false);
  });
});
