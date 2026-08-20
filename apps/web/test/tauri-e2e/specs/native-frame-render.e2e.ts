import { expect } from '@wdio/globals';
import { invokeTauri } from '../helpers/ipc.js';
import { prepareFixtureInTemp, removeE2eTempDir } from '../helpers/fs.js';

describe('Native Frame Render (P2)', () => {
  let tempDir: string;
  let tempPath: string;

  beforeEach(() => {
    const prepared = prepareFixtureInTemp('media/sample-1s-720p.mp4');
    tempDir = prepared.tempDir;
    tempPath = prepared.tempPath;
  });

  afterEach(() => {
    removeE2eTempDir(tempDir);
  });

  it('renders a WebP video frame from valid media file with RIFF/WEBP magic header', async () => {
    await invokeTauri('allow_path_scope', { path: tempDir });

    const frameBytes = await invokeTauri<number[]>('native_video_frame_webp', {
      sourcePath: tempPath,
      timeSec: 0.5,
      positionFraction: null,
      maxWidth: 320,
      maxHeight: 180,
      quality: 80,
    });

    expect(Array.isArray(frameBytes)).toBe(true);
    expect(frameBytes.length).toBeGreaterThan(100);

    // Assert WebP RIFF header bytes:
    // Bytes 0-3: 'R', 'I', 'F', 'F' (82, 73, 70, 70)
    // Bytes 8-11: 'W', 'E', 'B', 'P' (87, 69, 66, 80)
    expect(frameBytes[0]).toBe(82);
    expect(frameBytes[1]).toBe(73);
    expect(frameBytes[2]).toBe(70);
    expect(frameBytes[3]).toBe(70);

    expect(frameBytes[8]).toBe(87);
    expect(frameBytes[9]).toBe(69);
    expect(frameBytes[10]).toBe(66);
    expect(frameBytes[11]).toBe(80);
  });

  it('returns an error for non-existent video path', async () => {
    let renderError: Error | null = null;
    try {
      await invokeTauri('native_video_frame_webp', {
        sourcePath: '/tmp/non-existent-video-file-12345.mp4',
        timeSec: 0.0,
        positionFraction: null,
        maxWidth: 320,
        maxHeight: 180,
        quality: 80,
      });
    } catch (e) {
      renderError = e as Error;
    }

    expect(renderError).not.toBeNull();
  });
});
