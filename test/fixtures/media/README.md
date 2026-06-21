# Test Media Fixtures

Small **synthetic** media files covering every format FastCat advertises in
`src/utils/media-types.ts`. Used by e2e / integration tests.

Why synthetic instead of downloaded samples: deterministic & reproducible, tiny
(KB), no licensing concerns, and no network dependency in CI. Content is
recognisable on purpose so tests can assert real decoding — video uses a moving
`testsrc2` pattern, audio a 440 Hz sine, images solid colours / gradients.

All clips are ~1s. Total footprint ≈ 1.2 MB.

## Layout

```
test/fixtures/media/
├── sample-1s-720p.mp4        # legacy: 720p black H.264+AAC (kept for old tests)
├── sample-1s-audio.mp3       # legacy: 1s silent MP3
├── sample-red-1280x720.png   # legacy: solid-red 720p PNG
├── test_alpha_simple.webm    # legacy alpha clip (superseded by video/video-alpha-vp9.webm)
├── video/
│   ├── video-h264-aac.mp4 / .mov / .m4v   # H.264 + AAC
│   ├── video-mpeg4-mp3.avi                # legacy MPEG-4 + MP3
│   ├── video-vp9-opus.webm                # VP9 + Opus
│   ├── video-vp8-vorbis.webm              # VP8 + Vorbis
│   ├── video-av1-opus.mkv                 # AV1 + Opus
│   ├── video-prores.mov                   # ProRes 422 + PCM (pro ingest)
│   └── video-alpha-vp9.webm               # VP9 with real alpha plane (compositing)
├── audio/
│   └── audio-sine.{mp3,wav,aac,flac,ogg,opus,m4a,weba}   # 440 Hz tone
└── image/
    ├── image.{jpg,bmp,tiff,webp,avif}     # gradients
    ├── image-rgba.png                     # RGBA with a transparent corner
    ├── image.svg                          # vector
    ├── image-animated.gif                 # multi-frame
    └── image-animated.webp                # multi-frame
```

## Notes for test authors

- **Alpha video**: `ffprobe` reports `yuv420p` for VP9/WebM even with alpha — the
  alpha is signalled by the container `AlphaMode` flag, not `pix_fmt`. Verify by
  extracting the plane: `ffmpeg -c:v libvpx-vp9 -i f.webm -vf alphaextract ...`.
- **Animated WebP**: `ffprobe` cannot parse animated WebP ("image data not
  found"); the file is still valid (check `ANIM`/`ANMF` RIFF chunks). Browsers
  decode it fine, which is what the app uses.
- Audio is a 440 Hz sine → tests can assert spectral energy at that frequency.

## Regenerating

From the repo root (requires `ffmpeg` n6+ with libx264/libvpx/libsvtav1/libopus/
libvorbis/libmp3lame/libwebp/aom):

```bash
bash scripts/generate-test-fixtures.sh
```
