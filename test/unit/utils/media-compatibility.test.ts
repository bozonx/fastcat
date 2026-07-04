/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  computeMediaCompatibilityStatus,
  fileExtension,
  isAudioUndecodable,
  isImageUndisplayable,
  isVideoUndecodable,
  checkFileTimelineCompatibility,
} from '~/utils/media/compatibility';

describe('media compatibility predicates', () => {
  it('flags only explicit canDecode === false', () => {
    expect(isVideoUndecodable({ video: { canDecode: false } })).toBe(true);
    expect(isVideoUndecodable({ video: { canDecode: true } })).toBe(false);
    expect(isVideoUndecodable({ video: {} })).toBe(false);
    expect(isVideoUndecodable({})).toBe(false);
    expect(isVideoUndecodable(undefined)).toBe(false);

    expect(isAudioUndecodable({ audio: { canDecode: false } })).toBe(true);
    expect(isAudioUndecodable({ audio: { canDecode: true } })).toBe(false);
  });

  it('only treats browser-native image extensions as undisplayable', () => {
    expect(isImageUndisplayable({ image: { canDisplay: false } }, 'png')).toBe(true);
    expect(isImageUndisplayable({ image: { canDisplay: false } }, 'tiff')).toBe(false);
    expect(isImageUndisplayable({ image: { canDisplay: true } }, 'png')).toBe(false);
  });

  it('extracts a lower-cased extension', () => {
    expect(fileExtension('Clip.MP4')).toBe('mp4');
    expect(fileExtension('noext')).toBe('noext');
  });
});

describe('computeMediaCompatibilityStatus', () => {
  const base = {
    ext: 'mp4',
    isFailed: false,
    isLoading: false,
    treatUnknownAsOk: false,
  } as const;

  it('reports corrupt on a hard extraction failure regardless of media type', () => {
    expect(
      computeMediaCompatibilityStatus({ ...base, mediaType: 'video', meta: { error: true } }),
    ).toBe('corrupt');
    expect(
      computeMediaCompatibilityStatus({
        ...base,
        mediaType: 'video',
        meta: undefined,
        isFailed: true,
      }),
    ).toBe('corrupt');
  });

  it('distinguishes loading vs unknown-but-optimistic sources', () => {
    expect(
      computeMediaCompatibilityStatus({
        ...base,
        mediaType: 'video',
        meta: undefined,
        isLoading: true,
      }),
    ).toBe('checking');
    expect(computeMediaCompatibilityStatus({ ...base, mediaType: 'video', meta: undefined })).toBe(
      'checking',
    );
    expect(
      computeMediaCompatibilityStatus({
        ...base,
        mediaType: 'video',
        meta: undefined,
        treatUnknownAsOk: true,
      }),
    ).toBe('ok');
  });

  it('classifies video by video then audio decodability', () => {
    expect(
      computeMediaCompatibilityStatus({
        ...base,
        mediaType: 'video',
        meta: { video: { canDecode: false }, audio: { canDecode: false } },
      }),
    ).toBe('fully_unsupported');
    expect(
      computeMediaCompatibilityStatus({
        ...base,
        mediaType: 'video',
        meta: { video: { canDecode: true }, audio: { canDecode: false } },
      }),
    ).toBe('audio_unsupported');
    expect(
      computeMediaCompatibilityStatus({
        ...base,
        mediaType: 'video',
        meta: { video: { canDecode: true }, audio: { canDecode: true } },
      }),
    ).toBe('ok');
  });

  it('classifies audio sources by audio decodability', () => {
    expect(
      computeMediaCompatibilityStatus({
        ...base,
        ext: 'mp3',
        mediaType: 'audio',
        meta: { audio: { canDecode: false } },
      }),
    ).toBe('fully_unsupported');
  });

  it('treats undisplayable native images as corrupt, non-native as unsupported', () => {
    expect(
      computeMediaCompatibilityStatus({
        ...base,
        ext: 'png',
        mediaType: 'image',
        meta: { image: { canDisplay: false } },
      }),
    ).toBe('corrupt');
    expect(
      computeMediaCompatibilityStatus({
        ...base,
        ext: 'tiff',
        mediaType: 'image',
        meta: { image: { canDisplay: false } },
      }),
    ).toBe('fully_unsupported');
    expect(
      computeMediaCompatibilityStatus({
        ...base,
        ext: 'png',
        mediaType: 'image',
        meta: { image: { canDisplay: true } },
      }),
    ).toBe('ok');
  });
});

describe('checkFileTimelineCompatibility', () => {
  const mediaStore = {
    metadataLoadFailed: {},
    mediaMetadata: {},
  };

  it('rejects directories', () => {
    const res = checkFileTimelineCompatibility({ kind: 'directory', name: 'Folder', path: 'Folder' }, mediaStore);
    expect(res.compatible).toBe(false);
    expect(res.reasonKey).toBe('videoEditor.fileManager.compatibility.folderUnsupportedForTimeline');
  });

  it('rejects unknown format files', () => {
    const res = checkFileTimelineCompatibility({ kind: 'file', name: 'archive.zip', path: 'archive.zip' }, mediaStore);
    expect(res.compatible).toBe(false);
    expect(res.reasonKey).toBe('videoEditor.fileManager.compatibility.formatUnsupported');
  });

  it('accepts compatible video files', () => {
    const res = checkFileTimelineCompatibility({ kind: 'file', name: 'video.mp4', path: 'video.mp4' }, mediaStore);
    expect(res.compatible).toBe(true);
  });

  it('rejects corrupt files (metadata load failed)', () => {
    const customStore = {
      metadataLoadFailed: { 'video.mp4': true },
      mediaMetadata: {},
    };
    const res = checkFileTimelineCompatibility({ kind: 'file', name: 'video.mp4', path: 'video.mp4' }, customStore);
    expect(res.compatible).toBe(false);
    expect(res.reasonKey).toBe('videoEditor.fileManager.compatibility.corrupt');
  });

  it('rejects files with undecodable codecs', () => {
    const customStore = {
      metadataLoadFailed: {},
      mediaMetadata: {
        'video.mp4': { video: { canDecode: false } }
      },
    };
    const res = checkFileTimelineCompatibility({ kind: 'file', name: 'video.mp4', path: 'video.mp4' }, customStore);
    expect(res.compatible).toBe(false);
    expect(res.reasonKey).toBe('videoEditor.fileManager.compatibility.videoCodecUnsupported');
  });
});
