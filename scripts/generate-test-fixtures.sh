#!/usr/bin/env bash
set -euo pipefail

# Generate the synthetic test-media matrix used by e2e / integration tests.
#
# Why synthetic (vs. downloading samples)?
#   - deterministic & reproducible (byte-stable content patterns)
#   - tiny (KB), no licensing concerns, no network dependency in CI
#   - covers exactly the formats FastCat advertises in src/utils/media-types.ts
#
# Content is *recognisable* on purpose so tests can assert real decoding:
#   - video : `testsrc2` (moving pattern + on-screen timecode)
#   - audio : `sine` tone at a known frequency
#   - image : solid colours / gradients
#
# Requires ffmpeg (n6+). Run from the repo root:
#   bash scripts/generate-test-fixtures.sh

MEDIA_DIR="test/fixtures/media"
VID_DIR="$MEDIA_DIR/video"
AUD_DIR="$MEDIA_DIR/audio"
IMG_DIR="$MEDIA_DIR/image"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ERROR: ffmpeg not found on PATH" >&2
  exit 1
fi

mkdir -p "$VID_DIR" "$AUD_DIR" "$IMG_DIR"

# Common knobs kept tiny on purpose.
DUR=1
SIZE=320x240
RATE=15            # fps — low to keep files small
AR=48000          # audio sample rate
FREQ=440          # sine frequency (A4)

ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }

# Reusable lavfi sources.
VSRC=(-f lavfi -i "testsrc2=size=$SIZE:rate=$RATE:duration=$DUR")
ASRC=(-f lavfi -i "sine=frequency=$FREQ:sample_rate=$AR:duration=$DUR")

echo "==> Video (formats: mp4, mov, avi, mkv, webm, m4v)"
# Backward-compatible 720p black sample referenced by older tests.
ff -f lavfi -i "color=c=black:s=1280x720:d=$DUR" \
   -f lavfi -i "anullsrc=r=$AR:cl=stereo" -shortest \
   -c:v libx264 -preset ultrafast -crf 28 -pix_fmt yuv420p \
   -c:a aac -b:a 96k -movflags +faststart \
   "$MEDIA_DIR/sample-1s-720p.mp4"

ff "${VSRC[@]}" "${ASRC[@]}" -shortest \
   -c:v libx264 -preset ultrafast -crf 30 -pix_fmt yuv420p \
   -c:a aac -b:a 96k -movflags +faststart \
   "$VID_DIR/video-h264-aac.mp4"

ff "${VSRC[@]}" "${ASRC[@]}" -shortest \
   -c:v libx264 -preset ultrafast -crf 30 -pix_fmt yuv420p \
   -c:a aac -b:a 96k -movflags +faststart \
   "$VID_DIR/video-h264-aac.mov"

ff "${VSRC[@]}" "${ASRC[@]}" -shortest \
   -c:v libx264 -preset ultrafast -crf 30 -pix_fmt yuv420p \
   -c:a aac -b:a 96k -movflags +faststart \
   "$VID_DIR/video-h264-aac.m4v"

ff "${VSRC[@]}" "${ASRC[@]}" -shortest \
   -c:v mpeg4 -q:v 5 -c:a libmp3lame -q:a 6 \
   "$VID_DIR/video-mpeg4-mp3.avi"

ff "${VSRC[@]}" "${ASRC[@]}" -shortest \
   -c:v libvpx-vp9 -b:v 0 -crf 40 -cpu-used 5 -pix_fmt yuv420p \
   -c:a libopus -b:a 64k \
   "$VID_DIR/video-vp9-opus.webm"

ff "${VSRC[@]}" "${ASRC[@]}" -shortest \
   -c:v libvpx -b:v 256k -cpu-used 5 -pix_fmt yuv420p \
   -c:a libvorbis -q:a 3 \
   "$VID_DIR/video-vp8-vorbis.webm"

ff "${VSRC[@]}" "${ASRC[@]}" -shortest \
   -c:v libsvtav1 -preset 10 -crf 45 -pix_fmt yuv420p \
   -c:a libopus -b:a 64k \
   "$VID_DIR/video-av1-opus.mkv"

# Alpha/transparency video (yuva420p, VP9) for compositing tests.
# `-auto-alt-ref 0` is required or libvpx drops the alpha plane.
ff -f lavfi -i "testsrc2=size=200x200:rate=$RATE:duration=$DUR" \
   -vf "format=yuva420p,geq=a='if(lt(X,100),255,60)':r='r(X,Y)':g='g(X,Y)':b='b(X,Y)'" \
   -c:v libvpx-vp9 -pix_fmt yuva420p -auto-alt-ref 0 -b:v 0 -crf 40 -cpu-used 5 \
   "$VID_DIR/video-alpha-vp9.webm"

# ProRes (yuv422) in MOV — common pro-workflow ingest.
ff "${VSRC[@]}" "${ASRC[@]}" -shortest \
   -c:v prores_ks -profile:v 0 -pix_fmt yuv422p10le \
   -c:a pcm_s16le \
   "$VID_DIR/video-prores.mov"

echo "==> Audio (formats: mp3, wav, aac, flac, ogg, opus, m4a, weba)"
# Backward-compatible silent mp3 referenced by older tests.
ff -f lavfi -i "anullsrc=r=$AR:cl=stereo:d=$DUR" -c:a libmp3lame -q:a 4 \
   "$MEDIA_DIR/sample-1s-audio.mp3"

ff "${ASRC[@]}" -c:a libmp3lame -q:a 5 "$AUD_DIR/audio-sine.mp3"
ff "${ASRC[@]}" -c:a pcm_s16le "$AUD_DIR/audio-sine.wav"
ff "${ASRC[@]}" -c:a flac "$AUD_DIR/audio-sine.flac"
ff "${ASRC[@]}" -c:a aac -b:a 96k "$AUD_DIR/audio-sine.aac"
ff "${ASRC[@]}" -c:a aac -b:a 96k -movflags +faststart "$AUD_DIR/audio-sine.m4a"
ff "${ASRC[@]}" -c:a libvorbis -q:a 3 "$AUD_DIR/audio-sine.ogg"
ff "${ASRC[@]}" -c:a libopus -b:a 64k "$AUD_DIR/audio-sine.opus"
ff "${ASRC[@]}" -c:a libopus -b:a 64k -f webm "$AUD_DIR/audio-sine.weba"

echo "==> Image (formats: png, jpg, gif, webp, avif, bmp, tiff, svg)"
# Backward-compatible solid-red 720p PNG referenced by older tests.
ff -f lavfi -i "color=c=red:s=1280x720" -frames:v 1 \
   "$MEDIA_DIR/sample-red-1280x720.png"

# RGBA gradient with a transparent corner for alpha-aware image tests.
ff -f lavfi -i "color=c=blue:s=$SIZE,format=rgba,geq=r='X':g='Y':b=128:a='if(lt(X+Y,160),0,255)'" \
   -frames:v 1 "$IMG_DIR/image-rgba.png"
ff -f lavfi -i "gradients=s=$SIZE:c0=red:c1=yellow" -frames:v 1 "$IMG_DIR/image.jpg"
# bmp is uncompressed and tiff defaults to uncompressed — keep these small.
ff -f lavfi -i "gradients=s=160x120:c0=green:c1=blue" -frames:v 1 "$IMG_DIR/image.bmp"
ff -f lavfi -i "gradients=s=$SIZE:c0=magenta:c1=cyan" -frames:v 1 -compression_algo deflate "$IMG_DIR/image.tiff"
ff -f lavfi -i "gradients=s=$SIZE:c0=orange:c1=purple" -frames:v 1 -c:v libwebp -lossless 0 "$IMG_DIR/image.webp"
ff -f lavfi -i "gradients=s=$SIZE:c0=white:c1=black" -frames:v 1 -still-picture 1 "$IMG_DIR/image.avif"
# Animated formats (motion lets tests detect multi-frame decoding).
ff "${VSRC[@]}" -c:v gif "$IMG_DIR/image-animated.gif"
ff "${VSRC[@]}" -c:v libwebp_anim -loop 0 "$IMG_DIR/image-animated.webp"

# SVG is vector text — ffmpeg cannot emit it, so write it directly.
cat > "$IMG_DIR/image.svg" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240">
  <rect width="320" height="240" fill="#1e90ff"/>
  <circle cx="160" cy="120" r="80" fill="#ffd700"/>
  <text x="160" y="128" font-family="sans-serif" font-size="24" fill="#000" text-anchor="middle">FastCat</text>
</svg>
SVG

echo
echo "==> Done. Fixture tree:"
find "$MEDIA_DIR" -type f | sort
echo
echo "Total size:"
du -sh "$MEDIA_DIR"
