import { describe, expect, it } from 'vitest';

import {
  canCopyBloggerDogEntry,
  canCutBloggerDogEntry,
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
  it('allows copy for BloggerDog media and text wrapper, but cut only for media', () => {
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

    expect(canCopyBloggerDogEntry(mediaEntry)).toBe(true);
    expect(canCopyBloggerDogEntry(textWrapperEntry)).toBe(true);
    expect(canCopyBloggerDogEntry(contentItemEntry)).toBe(false);
    expect(canCutBloggerDogEntry(mediaEntry)).toBe(true);
    expect(canCutBloggerDogEntry(textWrapperEntry)).toBe(false);
    expect(canCutBloggerDogEntry(contentItemEntry)).toBe(false);
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

    expect(
      canTransferFsEntryToOrFromBloggerDog(remoteMediaEntry, {
        sourceIsBloggerDog: true,
        targetIsBloggerDog: false,
      }),
    ).toBe(true);
    expect(
      canTransferFsEntryToOrFromBloggerDog(remoteTextWrapper, {
        sourceIsBloggerDog: true,
        targetIsBloggerDog: false,
      }),
    ).toBe(true);
    expect(
      canTransferFsEntryToOrFromBloggerDog(localMediaEntry, {
        sourceIsBloggerDog: false,
        targetIsBloggerDog: true,
      }),
    ).toBe(true);
    expect(
      canTransferFsEntryToOrFromBloggerDog(localTextEntry, {
        sourceIsBloggerDog: false,
        targetIsBloggerDog: true,
      }),
    ).toBe(false);
    expect(
      canTransferClipboardItemToOrFromBloggerDog({
        kind: 'file',
        name: 'audio.mp3',
        path: 'audio.mp3',
      }, {
        sourceIsBloggerDog: true,
        targetIsBloggerDog: false,
      }),
    ).toBe(true);
    expect(
      canTransferClipboardItemToOrFromBloggerDog(
        {
          kind: 'file',
          name: 'script.txt',
          path: 'script.txt',
        },
        {
          sourceIsBloggerDog: true,
          targetIsBloggerDog: false,
        },
      ),
    ).toBe(true);
    expect(
      canTransferClipboardItemToOrFromBloggerDog({
        kind: 'directory',
        name: 'group',
        path: 'group',
      }, {
        sourceIsBloggerDog: true,
        targetIsBloggerDog: false,
      }),
    ).toBe(false);
  });
});
