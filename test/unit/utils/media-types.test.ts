import { describe, expect, it } from 'vitest';

import {
  getMimeTypeFromFilename,
  getMediaTypeFromFilename,
  isOpenableProjectFileName,
  isOpenableProjectTextFilename,
  validateMediaTrackCompatibility,
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
    expect(getMimeTypeFromFilename('asset://localhost/path/video.mkv?ts=1#frag')).toBe(
      'video/x-matroska',
    );
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
});
