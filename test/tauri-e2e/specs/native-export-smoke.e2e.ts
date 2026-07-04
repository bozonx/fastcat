import fs from 'node:fs';
import path from 'node:path';
import { expect } from '@wdio/globals';
import { invokeTauri } from '../helpers/ipc.js';
import { prepareFixtureInTemp, createE2eTempDir, removeE2eTempDir } from '../helpers/fs.js';

interface NativeMediaMetadata {
  duration: number;
  container: string;
}

describe('Native Export Smoke (P2)', () => {
  let sourceTempDir: string;
  let sourceTempPath: string;
  let exportTempDir: string;

  beforeEach(() => {
    const prepared = prepareFixtureInTemp('media/sample-1s-audio.mp3');
    sourceTempDir = prepared.tempDir;
    sourceTempPath = prepared.tempPath;
    exportTempDir = createE2eTempDir('export');
  });

  afterEach(() => {
    removeE2eTempDir(sourceTempDir);
    removeE2eTempDir(exportTempDir);
  });

  it('runs a minimal native timeline export, creates output file, and validates probed metadata', async () => {
    // Extend scope for source & export destination
    await invokeTauri('allow_path_scope', { path: sourceTempDir });
    await invokeTauri('allow_path_scope', { path: exportTempDir });

    const targetPath = path.join(exportTempDir, 'exported_output.wav');

    const scene = {
      layers: [],
      audio_layers: [
        {
          id: 'export-smoke-audio',
          path: sourceTempPath,
          timeline_start_sec: 0.0,
          timeline_end_sec: 0.5,
          source_start_sec: 0.0,
        },
      ],
    };

    const options = {
      width: 320,
      height: 240,
      fps: 30.0,
      startSec: 0.0,
      endSec: 0.5,
      videoCodec: '',
      videoBitrateBps: 0,
      format: 'wav',
      audioEnabled: true,
      audioCodec: 'pcm',
      audioBitrateBps: null,
      audioChannels: 1,
      audioSampleRate: 44100,
      videoEnabled: false,
    };

    // Invoke native export command
    await invokeTauri('native_timeline_export', {
      taskId: 'tauri-e2e-export-task',
      scene,
      options,
      targetPath,
    });

    // Assert file exists and is non-empty
    expect(fs.existsSync(targetPath)).toBe(true);
    const stats = fs.statSync(targetPath);
    expect(stats.size).toBeGreaterThan(0);

    // Optionally probe the generated file metadata
    const metadata = await invokeTauri<NativeMediaMetadata>('native_media_metadata', {
      path: targetPath,
    });
    expect(metadata).toBeDefined();
    expect(metadata.duration).toBeGreaterThan(0);
  });
});
