import { describe, expect, it } from 'vitest';

import {
  getMimeTypeFromFilename,
  getMediaTypeFromFilename,
  isOpenableProjectFileName,
  isOpenableProjectTextFilename,
} from '~/utils/media-types';

describe('media-types', () => {
  it('treats known text formats as openable project text files', () => {
    expect(isOpenableProjectTextFilename('notes.md')).toBe(true);
    expect(isOpenableProjectTextFilename('scene.json')).toBe(true);
    expect(isOpenableProjectTextFilename('config.yaml')).toBe(true);
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
    expect(getMimeTypeFromFilename('asset://localhost/path/video.mkv?ts=1#frag')).toBe('video/x-matroska');
    expect(getMimeTypeFromFilename('audio.wav?v=2')).toBe('audio/wav');
    expect(getMimeTypeFromFilename('unknown.xyz')).toBe('application/octet-stream');
  });

  it('extracts media type ignoring query and hash', () => {
    expect(getMediaTypeFromFilename('clip.mp4?v=123')).toBe('video');
    expect(getMediaTypeFromFilename('clip.mp4#v=123')).toBe('video');
    expect(getMediaTypeFromFilename('asset://localhost/path/clip.mkv?ts=1')).toBe('video');
    expect(getMediaTypeFromFilename('track.wav#hash')).toBe('audio');
    expect(getMediaTypeFromFilename('doc.txt?v=1')).toBe('text');
  });
});
