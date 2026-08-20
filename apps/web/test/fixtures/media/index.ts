import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path to `test/fixtures/media`. */
export const MEDIA_FIXTURES_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Resolve a fixture by its path relative to `test/fixtures/media`. */
export function mediaFixture(relativePath: string): string {
  return path.join(MEDIA_FIXTURES_DIR, relativePath);
}

/**
 * Named handles for the synthetic media matrix (see ./README.md).
 * Use with `loadFixtureIntoOpfs` (web e2e) or direct fs reads.
 */
export const MEDIA_FIXTURES = {
  video: {
    h264Mp4: mediaFixture('video/video-h264-aac.mp4'),
    h264Mov: mediaFixture('video/video-h264-aac.mov'),
    h264M4v: mediaFixture('video/video-h264-aac.m4v'),
    mpeg4Avi: mediaFixture('video/video-mpeg4-mp3.avi'),
    vp9Webm: mediaFixture('video/video-vp9-opus.webm'),
    vp8Webm: mediaFixture('video/video-vp8-vorbis.webm'),
    av1Mkv: mediaFixture('video/video-av1-opus.mkv'),
    prores: mediaFixture('video/video-prores.mov'),
    alphaWebm: mediaFixture('video/video-alpha-vp9.webm'),
  },
  audio: {
    mp3: mediaFixture('audio/audio-sine.mp3'),
    wav: mediaFixture('audio/audio-sine.wav'),
    aac: mediaFixture('audio/audio-sine.aac'),
    flac: mediaFixture('audio/audio-sine.flac'),
    ogg: mediaFixture('audio/audio-sine.ogg'),
    opus: mediaFixture('audio/audio-sine.opus'),
    m4a: mediaFixture('audio/audio-sine.m4a'),
    weba: mediaFixture('audio/audio-sine.weba'),
  },
  image: {
    jpg: mediaFixture('image/image.jpg'),
    pngRgba: mediaFixture('image/image-rgba.png'),
    bmp: mediaFixture('image/image.bmp'),
    tiff: mediaFixture('image/image.tiff'),
    webp: mediaFixture('image/image.webp'),
    avif: mediaFixture('image/image.avif'),
    svg: mediaFixture('image/image.svg'),
    gifAnimated: mediaFixture('image/image-animated.gif'),
    webpAnimated: mediaFixture('image/image-animated.webp'),
  },
  /** Legacy fixtures kept for backwards-compatible references. */
  legacy: {
    mp4: mediaFixture('sample-1s-720p.mp4'),
    mp3: mediaFixture('sample-1s-audio.mp3'),
    png: mediaFixture('sample-red-1280x720.png'),
    alphaWebm: mediaFixture('test_alpha_simple.webm'),
  },
} as const;
