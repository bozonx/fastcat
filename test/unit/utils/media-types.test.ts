import { describe, expect, it } from 'vitest';

import {
  extOf,
  getMimeTypeFromFilename,
  getMediaTypeFromFilename,
  getIconForMediaType,
  isImageMimeType,
  isImagePath,
  isOpenableProjectFileName,
  isOpenableProjectTextFilename,
  validateMediaTrackCompatibility,
} from '~/utils/media-types';

describe('media-types', () => {
  describe('extOf', () => {
    it('returns lowercase extension', () => {
      expect(extOf('file.PNG')).toBe('png');
      expect(extOf('file.jpg')).toBe('jpg');
      expect(extOf('file')).toBe('');
    });

    it('ignores query and hash suffixes', () => {
      expect(extOf('clip.mp4?v=1')).toBe('mp4');
      expect(extOf('clip.mp4#frag')).toBe('mp4');
    });
  });

  describe('isImagePath', () => {
    it('returns true for image extensions', () => {
      expect(isImagePath('file.png')).toBe(true);
      expect(isImagePath('file.jpg')).toBe(true);
      expect(isImagePath('file.jpeg')).toBe(true);
      expect(isImagePath('file.webp')).toBe(true);
      expect(isImagePath('file.gif')).toBe(true);
      expect(isImagePath('file.svg')).toBe(true);
    });

    it('returns false for non-image extensions', () => {
      expect(isImagePath('file.mp4')).toBe(false);
      expect(isImagePath('file')).toBe(false);
    });
  });

  describe('isImageMimeType', () => {
    it('returns true for image mime types', () => {
      expect(isImageMimeType('image/png')).toBe(true);
      expect(isImageMimeType('image/jpeg')).toBe(true);
    });

    it('returns false for non-image mime types', () => {
      expect(isImageMimeType('video/mp4')).toBe(false);
    });
  });

  it('treats known text formats as openable project text files', () => {
    expect(isOpenableProjectTextFilename('notes.md')).toBe(true);
    expect(isOpenableProjectTextFilename('scene.json')).toBe(true);
    expect(isOpenableProjectTextFilename('config.yaml')).toBe(true);
    expect(isOpenableProjectTextFilename('subs.vtt')).toBe(true);
    expect(isOpenableProjectTextFilename('data.tsv')).toBe(true);
    expect(isOpenableProjectTextFilename('data.csv')).toBe(true);
  });

  it('keeps binary files non-openable as text', () => {
    expect(isOpenableProjectTextFilename('clip.mp4')).toBe(false);
  });

  it('allows text files to open as project files', () => {
    expect(isOpenableProjectFileName('notes.txt')).toBe(true);
    expect(isOpenableProjectFileName('config.yml')).toBe(true);
  });

  it('extracts MIME type ignoring query and hash', () => {
    expect(getMimeTypeFromFilename('video.mp4?v=123')).toBe('video/mp4');
    expect(getMimeTypeFromFilename('video.mp4#v=123')).toBe('video/mp4');
    expect(getMimeTypeFromFilename('asset://localhost/path/video.mkv?ts=1#frag')).toBe(
      'video/x-matroska',
    );
    expect(getMimeTypeFromFilename('audio.wav?v=2')).toBe('audio/wav');
    expect(getMimeTypeFromFilename('subs.vtt')).toBe('text/vtt');
    expect(getMimeTypeFromFilename('data.tsv')).toBe('text/tab-separated-values');
    expect(getMimeTypeFromFilename('data.csv')).toBe('text/csv');
    expect(getMimeTypeFromFilename('unknown.xyz')).toBe('application/octet-stream');
  });

  it('extracts media type ignoring query and hash', () => {
    expect(getMediaTypeFromFilename('clip.mp4?v=123')).toBe('video');
    expect(getMediaTypeFromFilename('clip.mp4#v=123')).toBe('video');
    expect(getMediaTypeFromFilename('asset://localhost/path/clip.mkv?ts=1')).toBe('video');
    expect(getMediaTypeFromFilename('track.wav#hash')).toBe('audio');
    expect(getMediaTypeFromFilename('doc.txt?v=1')).toBe('text');
  });

  it('allows audio only on audio tracks', () => {
    expect(validateMediaTrackCompatibility('audio', 'audio')).toBe(true);
    expect(validateMediaTrackCompatibility('audio', 'video')).toBe(false);
  });

  it('allows video, image and timeline only on video tracks', () => {
    expect(validateMediaTrackCompatibility('video', 'video')).toBe(true);
    expect(validateMediaTrackCompatibility('video', 'audio')).toBe(false);
    expect(validateMediaTrackCompatibility('image', 'video')).toBe(true);
    expect(validateMediaTrackCompatibility('image', 'audio')).toBe(false);
    expect(validateMediaTrackCompatibility('timeline', 'video')).toBe(true);
    expect(validateMediaTrackCompatibility('timeline', 'audio')).toBe(false);
  });

  it('rejects unknown or text media types on any track', () => {
    expect(validateMediaTrackCompatibility('unknown', 'video')).toBe(false);
    expect(validateMediaTrackCompatibility('unknown', 'audio')).toBe(false);
    expect(validateMediaTrackCompatibility('text', 'video')).toBe(false);
    expect(validateMediaTrackCompatibility('text', 'audio')).toBe(false);
  });

  describe('getIconForMediaType', () => {
    it('returns film icon for video', () => {
      expect(getIconForMediaType('video')).toBe('i-heroicons-film');
    });

    it('returns musical note icon for audio', () => {
      expect(getIconForMediaType('audio')).toBe('i-heroicons-musical-note');
    });

    it('returns photo icon for image', () => {
      expect(getIconForMediaType('image')).toBe('i-heroicons-photo');
    });

    it('returns document-text icon for text and timeline', () => {
      expect(getIconForMediaType('text')).toBe('i-heroicons-document-text');
      expect(getIconForMediaType('timeline')).toBe('i-heroicons-document-text');
    });

    it('returns file-question-mark icon for unknown type', () => {
      expect(getIconForMediaType('unknown')).toBe('i-lucide-file-question-mark');
    });
  });
});
