# Test Media Fixtures

Small synthetic media files used by e2e and integration tests.

## Files

| File | Description | Size |
|------|-------------|------|
| `sample-1s-720p.mp4` | 1-second black video (H.264 + AAC) | ~6 KB |
| `sample-1s-audio.mp3` | 1-second silent audio (MP3) | ~4 KB |
| `sample-red-1280x720.png` | Solid red 1280x720 PNG | ~4 KB |

## Regenerating

Run the helper script from the repo root:

```bash
bash scripts/generate-test-fixtures.sh
```

Or manually with `ffmpeg`:

```bash
# Video
ffmpeg -f lavfi -i "color=c=black:s=1280x720:d=1" \
       -f lavfi -i "anullsrc=r=48000:cl=stereo" \
       -shortest -c:v libx264 -preset ultrafast -crf 28 \
       -c:a aac -b:a 128k -movflags +faststart \
       -y test/fixtures/media/sample-1s-720p.mp4

# Audio
ffmpeg -f lavfi -i "anullsrc=r=48000:cl=stereo:d=1" \
       -c:a libmp3lame -q:a 4 \
       -y test/fixtures/media/sample-1s-audio.mp3

# Image
ffmpeg -f lavfi -i "color=c=red:s=1280x720" -frames:v 1 \
       -y test/fixtures/media/sample-red-1280x720.png
```
