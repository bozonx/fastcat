import { ref } from 'vue';
import { describe, expect, it } from 'vitest';
import { useBloggerDogEntryInfo } from '~/composables/properties/useBloggerDogEntryInfo';

function build(entry: any, flags: Record<string, boolean> = {}, fileKind = 'directory') {
  return useBloggerDogEntryInfo({
    selectedFsEntry: () => entry,
    fileInfo: ref({ kind: fileKind }),
    isBloggerDogContentItem: ref(flags.contentItem ?? false),
    isBloggerDogGroup: ref(flags.group ?? false),
    isBloggerDogProject: ref(flags.project ?? false),
    isBloggerDogMedia: ref(flags.media ?? false),
  });
}

describe('useBloggerDogEntryInfo', () => {
  it('aggregates remote-content flags', () => {
    expect(build({}, {}).isRemoteContent.value).toBe(false);
    expect(build({}, { group: true }).isRemoteContent.value).toBe(true);
    expect(build({}, { project: true }).isRemoteContent.value).toBe(true);
  });

  it('returns null remote record when entry is not remote content', () => {
    const info = build({ kind: 'directory', name: 'd', path: '/d' }, {});
    expect(info.castedRemoteRecord.value).toBeNull();
  });

  it('decodes the remote record from adapterPayload for remote content', () => {
    const entry = {
      kind: 'directory',
      name: 'g',
      path: '/g',
      adapterPayload: { remoteData: { id: 'g1', itemsCount: 7 } },
    };
    const info = build(entry, { group: true });
    expect((info.castedRemoteRecord.value as any)?.id).toBe('g1');
    expect(info.remoteItemsCount.value).toBe(7);
  });

  it('reads media count for directory entries only', () => {
    const entry = {
      kind: 'directory',
      name: 'c',
      path: '/c',
      adapterPayload: { remoteData: { media: [1, 2, 3] } },
    };
    expect(build(entry, { contentItem: true }, 'directory').remoteMediaCount.value).toBe(3);
    // For a file fileInfo, media count is intentionally undefined.
    expect(build(entry, { contentItem: true }, 'file').remoteMediaCount.value).toBeUndefined();
  });
});
