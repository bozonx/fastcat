/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import {
  VIDEO_EXTENSIONS,
  AUDIO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  getMediaTypeFromFilename,
  getMimeTypeFromFilename,
} from '~/utils/media-types';
import { mediaFixture } from '../../../fixtures/media';

/**
 * Single source of truth tying every import format FastCat advertises
 * (media-types.ts) to a real synthetic fixture (test/fixtures/media). If a
 * format is added to the advertised lists without a fixture — or a fixture is
 * deleted — this matrix fails, so "we support format X" can never drift away
 * from "we actually have a file to decode X with".
 *
 * Aliases that share another extension's bytes (jpeg→jpg, tif→tiff) carry no
 * dedicated fixture; they are exercised only for type/MIME detection below.
 */
const FIXTURE_BY_EXT: Record<string, string> = {
  // video — one representative container per advertised extension
  mp4: 'video/video-h264-aac.mp4',
  mov: 'video/video-h264-aac.mov',
  m4v: 'video/video-h264-aac.m4v',
  avi: 'video/video-mpeg4-mp3.avi',
  mkv: 'video/video-av1-opus.mkv',
  webm: 'video/video-vp9-opus.webm',
  // audio — every advertised container/codec
  mp3: 'audio/audio-sine.mp3',
  wav: 'audio/audio-sine.wav',
  aac: 'audio/audio-sine.aac',
  flac: 'audio/audio-sine.flac',
  ogg: 'audio/audio-sine.ogg',
  opus: 'audio/audio-sine.opus',
  m4a: 'audio/audio-sine.m4a',
  weba: 'audio/audio-sine.weba',
  // image — every advertised format
  jpg: 'image/image.jpg',
  png: 'image/image-rgba.png',
  gif: 'image/image-animated.gif',
  webp: 'image/image.webp',
  svg: 'image/image.svg',
  avif: 'image/image.avif',
  bmp: 'image/image.bmp',
  tiff: 'image/image.tiff',
};

/** Extensions that are pure aliases of another (no dedicated fixture needed). */
const ALIAS_EXTENSIONS = new Set(['jpeg', 'tif']);

describe('media format import matrix', () => {
  describe('type detection covers every advertised extension', () => {
    it('classifies all VIDEO_EXTENSIONS as video', () => {
      for (const ext of VIDEO_EXTENSIONS) {
        expect(getMediaTypeFromFilename(`clip.${ext}`), `clip.${ext}`).toBe('video');
      }
    });

    it('classifies all AUDIO_EXTENSIONS as audio', () => {
      for (const ext of AUDIO_EXTENSIONS) {
        expect(getMediaTypeFromFilename(`tone.${ext}`), `tone.${ext}`).toBe('audio');
      }
    });

    it('classifies all IMAGE_EXTENSIONS (and jpeg/tif aliases) as image', () => {
      for (const ext of [...IMAGE_EXTENSIONS, 'jpeg', 'tif']) {
        expect(getMediaTypeFromFilename(`pic.${ext}`), `pic.${ext}`).toBe('image');
      }
    });

    it('returns a concrete (non-octet-stream) MIME for every advertised extension', () => {
      const all = [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS, ...IMAGE_EXTENSIONS, 'jpeg', 'tif'];
      for (const ext of all) {
        const mime = getMimeTypeFromFilename(`f.${ext}`);
        expect(mime, `f.${ext}`).not.toBe('application/octet-stream');
        expect(mime, `f.${ext}`).toMatch(/^(video|audio|image)\//);
      }
    });
  });

  describe('fixture coverage', () => {
    it('every advertised extension has a decodable fixture (or is a documented alias)', () => {
      const advertised = [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS, ...IMAGE_EXTENSIONS];
      const missing: string[] = [];

      for (const ext of advertised) {
        if (ALIAS_EXTENSIONS.has(ext)) continue;
        const rel = FIXTURE_BY_EXT[ext];
        if (!rel) {
          missing.push(`${ext} (no entry in FIXTURE_BY_EXT)`);
          continue;
        }
        if (!existsSync(mediaFixture(rel))) {
          missing.push(`${ext} → ${rel} (file not found)`);
        }
      }

      expect(
        missing,
        `Advertised import format(s) without a usable fixture. Add a synthetic ` +
          `fixture (scripts/generate-test-fixtures.sh) and map it in FIXTURE_BY_EXT:\n` +
          missing.map((m) => `    - ${m}`).join('\n'),
      ).toEqual([]);
    });

    it('each fixture is detected as the media type its extension advertises', () => {
      const expectedType = (ext: string): 'video' | 'audio' | 'image' =>
        VIDEO_EXTENSIONS.includes(ext)
          ? 'video'
          : AUDIO_EXTENSIONS.includes(ext)
            ? 'audio'
            : 'image';

      for (const [ext, rel] of Object.entries(FIXTURE_BY_EXT)) {
        expect(getMediaTypeFromFilename(rel), rel).toBe(expectedType(ext));
      }
    });
  });
});
