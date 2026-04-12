import { describe, expect, it } from 'vitest';

import {
  canCopyCutBloggerDogEntry,
  canPasteIntoBloggerDogEntry,
  canTransferClipboardItemToOrFromBloggerDog,
  canTransferFsEntryToOrFromBloggerDog,
} from '~/utils/bloggerdog-file-manager';
import type { FsEntry } from '~/types/fs';

function createBloggerDogEntry(params: {
  kind: FsEntry['kind'];
  name: string;
  path: string;
  payloadType: 'content-item' | 'collection' | 'media' | 'project' | 'virtual-folder';
  mediaId?: string;
  remoteId?: string;
}): FsEntry {
  return {
    kind: params.kind,
    name: params.name,
    path: params.path,
    source: 'remote',
    remoteId: params.remoteId,
    adapterPayload: {
      type: params.payloadType,
      remoteData: { id: params.remoteId ?? params.path },
      mediaId: params.mediaId,
    },
  };
}

describe('bloggerdog file manager rules', () => {
  it('allows copy/cut only for BloggerDog media files', () => {
    const mediaEntry = createBloggerDogEntry({
      kind: 'file',
      name: 'clip.mp4',
      path: '/personal/item-1/clip.mp4',
      payloadType: 'media',
      mediaId: 'media-1',
    });
    const textWrapperEntry = createBloggerDogEntry({
      kind: 'file',
      name: 'Item.txt',
      path: '/personal/item-1/Item.txt',
      payloadType: 'media',
    });
    const contentItemEntry = createBloggerDogEntry({
      kind: 'directory',
      name: 'Item',
      path: '/personal/item-1',
      payloadType: 'content-item',
    });

    expect(canCopyCutBloggerDogEntry(mediaEntry)).toBe(true);
    expect(canCopyCutBloggerDogEntry(textWrapperEntry)).toBe(true);
    expect(canCopyCutBloggerDogEntry(contentItemEntry)).toBe(false);
  });

  it('allows paste only into BloggerDog content items', () => {
    const contentItemEntry = createBloggerDogEntry({
      kind: 'directory',
      name: 'Item',
      path: '/personal/item-1',
      payloadType: 'content-item',
    });
    const groupEntry = createBloggerDogEntry({
      kind: 'directory',
      name: 'Group',
      path: '/personal/group-1',
      payloadType: 'collection',
    });

    expect(canPasteIntoBloggerDogEntry(contentItemEntry)).toBe(true);
    expect(canPasteIntoBloggerDogEntry(groupEntry)).toBe(false);
  });

  it('allows BloggerDog cross-transfer only for media files', () => {
    const remoteMediaEntry = createBloggerDogEntry({
      kind: 'file',
      name: 'clip.mp4',
      path: '/personal/item-1/clip.mp4',
      payloadType: 'media',
      mediaId: 'media-1',
    });
    const remoteTextWrapper = createBloggerDogEntry({
      kind: 'file',
      name: 'Item.txt',
      path: '/personal/item-1/Item.txt',
      payloadType: 'media',
    });
    const localMediaEntry: FsEntry = {
      kind: 'file',
      name: 'photo.jpg',
      path: 'assets/photo.jpg',
      source: 'local',
    };
    const localTextEntry: FsEntry = {
      kind: 'file',
      name: 'note.txt',
      path: 'docs/note.txt',
      source: 'local',
    };

    expect(canTransferFsEntryToOrFromBloggerDog(remoteMediaEntry)).toBe(true);
    expect(canTransferFsEntryToOrFromBloggerDog(remoteTextWrapper)).toBe(false);
    expect(canTransferFsEntryToOrFromBloggerDog(localMediaEntry)).toBe(true);
    expect(canTransferFsEntryToOrFromBloggerDog(localTextEntry)).toBe(false);
    expect(
      canTransferClipboardItemToOrFromBloggerDog({
        kind: 'file',
        name: 'audio.mp3',
        path: 'audio.mp3',
      }),
    ).toBe(true);
    expect(
      canTransferClipboardItemToOrFromBloggerDog({
        kind: 'directory',
        name: 'group',
        path: 'group',
      }),
    ).toBe(false);
  });
});
