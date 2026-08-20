import fs from 'node:fs';
import path from 'node:path';
import { expect } from '@wdio/globals';
import { invokeTauri } from '../helpers/ipc.js';
import { prepareFixtureInTemp, createE2eTempDir, removeE2eTempDir } from '../helpers/fs.js';

interface NativeVideoMetadata {
  width: number;
  height: number;
  fps: number;
  codec: string;
}

interface NativeMediaMetadata {
  duration: number;
  container: string;
  video?: NativeVideoMetadata | null;
  audio?: unknown;
}

/** True when a native export failed only because no wgpu adapter is available
 * (headless CI without a software Vulkan device). The audio-only export path
 * needs no GPU, but the video path renders through the vello/wgpu compositor —
 * mirror the Rust integration test's `skip_unless!(Compositor::is_gpu_available())`
 * so the suite stays green on GPU-less machines instead of hard-failing. */
function isNoGpuExportError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err).toLowerCase();
  return (
    msg.includes('no gpu') ||
    msg.includes('adapter') ||
    msg.includes('wgpu') ||
    msg.includes('vello') ||
    msg.includes('no renderer')
  );
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

  // Video export goes through the vello/wgpu compositor -> ffmpeg encode, a path
  // the audio-only smoke never touches. Regular `function` (not arrow) so we can
  // `this.skip()` when the harness has no GPU adapter.
  it('runs a native video export (mp4/h264) and probes a real video stream', async function () {
    const video = prepareFixtureInTemp('media/sample-1s-720p.mp4');
    try {
      await invokeTauri('allow_path_scope', { path: video.tempDir });
      await invokeTauri('allow_path_scope', { path: exportTempDir });

      const targetPath = path.join(exportTempDir, 'exported_video.mp4');

      const scene = {
        layers: [
          {
            id: 'export-smoke-bg',
            kind: 'background',
            timeline_start_sec: 0.0,
            timeline_end_sec: 0.5,
            source_start_sec: 0.0,
            background_color: '#000000',
            z: 0,
            opacity: 1.0,
          },
          {
            id: 'export-smoke-video',
            kind: 'video',
            path: video.tempPath,
            timeline_start_sec: 0.0,
            timeline_end_sec: 0.5,
            source_start_sec: 0.0,
            source_range_duration_sec: 0.5,
            z: 1,
            opacity: 1.0,
          },
        ],
        audio_layers: [],
      };

      const options = {
        width: 320,
        height: 240,
        fps: 15.0,
        startSec: 0.0,
        endSec: 0.5,
        videoCodec: 'avc1.64001f',
        videoBitrateBps: 1_000_000,
        format: 'mp4',
        audioEnabled: false,
        audioCodec: null,
        audioBitrateBps: null,
        audioChannels: null,
        audioSampleRate: null,
        videoEnabled: true,
      };

      try {
        await invokeTauri('native_timeline_export', {
          taskId: 'tauri-e2e-export-video-task',
          scene,
          options,
          targetPath,
        });
      } catch (err) {
        if (isNoGpuExportError(err)) {
          this.skip();
          return;
        }
        throw err;
      }

      expect(fs.existsSync(targetPath)).toBe(true);
      expect(fs.statSync(targetPath).size).toBeGreaterThan(0);

      const metadata = await invokeTauri<NativeMediaMetadata>('native_media_metadata', {
        path: targetPath,
      });
      expect(metadata).toBeDefined();
      expect(metadata.duration).toBeGreaterThan(0);
      // The durable signal that this really produced a video (not just a file):
      // an actual H.264 stream at the requested output resolution.
      expect(metadata.video).toBeTruthy();
      expect(metadata.video!.width).toBe(320);
      expect(metadata.video!.height).toBe(240);
      expect(metadata.video!.codec.toLowerCase()).toContain('h264');
    } finally {
      removeE2eTempDir(video.tempDir);
    }
  });
});
