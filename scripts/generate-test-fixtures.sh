#!/bin/bash
set -e

MEDIA_DIR="test/fixtures/media"
mkdir -p "$MEDIA_DIR"

echo "Generating test media fixtures..."

ffmpeg -f lavfi -i "color=c=black:s=1280x720:d=1" \
       -f lavfi -i "anullsrc=r=48000:cl=stereo" \
       -shortest \
       -c:v libx264 -preset ultrafast -crf 28 \
       -c:a aac -b:a 128k \
       -movflags +faststart \
       -y "$MEDIA_DIR/sample-1s-720p.mp4" \
       2>/dev/null

ffmpeg -f lavfi -i "anullsrc=r=48000:cl=stereo:d=1" \
       -c:a libmp3lame -q:a 4 \
       -y "$MEDIA_DIR/sample-1s-audio.mp3" \
       2>/dev/null

ffmpeg -f lavfi -i "color=c=red:s=1280x720" \
       -frames:v 1 \
       -y "$MEDIA_DIR/sample-red-1280x720.png" \
       2>/dev/null

echo "Done. Files in $MEDIA_DIR:"
ls -la "$MEDIA_DIR"
