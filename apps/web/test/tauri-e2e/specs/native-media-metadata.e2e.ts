import { expect } from '@wdio/globals';
import { invokeTauri } from '../helpers/ipc.js';
import { prepareFixtureInTemp, removeE2eTempDir } from '../helpers/fs.js';

interface NativeMediaMetadata {
  duration: number;
  container: string;
  video?: {
    width: number;
    height: number;
    fps: number;
    codec: string;
    bitrate?: number;
    rotation: number;
    canDecode?: boolean;
  } | null;
  audio?: {
    codec: string;
    bitrate?: number;
    sampleRate?: number;
    channels?: number;
  } | null;
}

describe('Native Media Metadata (P1)', () => {
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

  it('probes media metadata for a real video file inside allowed path scope', async () => {
    // Extend scope to the temp directory
    await invokeTauri('allow_path_scope', { path: tempDir });

    // Invoke native media metadata
    const metadata = await invokeTauri<NativeMediaMetadata>('native_media_metadata', {
      path: tempPath,
    });

    expect(metadata).toBeDefined();
    expect(metadata.duration).toBeGreaterThan(0.5);
    expect(metadata.duration).toBeLessThan(2.0);
    expect(typeof metadata.container).toBe('string');
    expect(metadata.container.length).toBeGreaterThan(0);

    // Video stream metadata assertions
    expect(metadata.video).toBeDefined();
    expect(metadata.video?.width).toBe(1280);
    expect(metadata.video?.height).toBe(720);
    expect(metadata.video?.fps).toBeGreaterThan(0);
    expect(typeof metadata.video?.codec).toBe('string');

    // Audio stream metadata assertions
    expect(metadata.audio).toBeDefined();
    expect(typeof metadata.audio?.codec).toBe('string');
  });
});
