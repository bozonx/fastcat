import type { VideoCoreHostAPI } from '../../utils/video-editor/worker-client';
import { VideoCompositor } from '../../utils/video-editor/VideoCompositor';
import { parseVideoCodec, parseAudioCodec, getBunnyVideoCodec } from './utils';
import { buildMixedAudioTrack } from './audio';

export async function extractMetadata(fileHandle: FileSystemFileHandle) {
  const file = await fileHandle.getFile();

  if (typeof file?.type === 'string' && file.type.startsWith('image/')) {
    return {
      source: {
        size: file.size,
        lastModified: file.lastModified,
      },
      duration: 0,
    };
  }

  const { Input, BlobSource, ALL_FORMATS } = await import('mediabunny');
  const source = new BlobSource(file);
  const input = new Input({ source, formats: ALL_FORMATS } as any);

  try {
    const durationS = await input.computeDuration();
    const vTrack = await input.getPrimaryVideoTrack();
    const aTrack = await input.getPrimaryAudioTrack();

    const meta: any = {
      source: {
        size: file.size,
        lastModified: file.lastModified,
      },
      duration: durationS,
    };

    if (vTrack) {
      const stats = await vTrack.computePacketStats(100);
      const codecParam = await vTrack.getCodecParameterString();
      const colorSpace =
        typeof vTrack.getColorSpace === 'function' ? await vTrack.getColorSpace() : undefined;

      meta.video = {
        width: vTrack.codedWidth,
        height: vTrack.codedHeight,
        displayWidth: vTrack.displayWidth,
        displayHeight: vTrack.displayHeight,
        rotation: vTrack.rotation,
        codec: codecParam || vTrack.codec || '',
        parsedCodec: parseVideoCodec(codecParam || vTrack.codec || ''),
        fps: stats.averagePacketRate,
        colorSpace,
      };
    }

    if (aTrack) {
      const codecParam = await aTrack.getCodecParameterString();
      meta.audio = {
        codec: codecParam || aTrack.codec || '',
        parsedCodec: parseAudioCodec(codecParam || aTrack.codec || ''),
        sampleRate: aTrack.sampleRate,
        channels: aTrack.numberOfChannels,
      };
    }

    return meta;
  } finally {
    if ('dispose' in input && typeof (input as any).dispose === 'function')
      (input as any).dispose();
    else if ('close' in input && typeof (input as any).close === 'function') (input as any).close();
  }
}

export async function runExport(
  targetHandle: FileSystemFileHandle,
  options: any,
  timelineClips: any[],
  audioClips: any[],
  hostClient: VideoCoreHostAPI | null,
  reportExportWarning: (msg: string) => Promise<void>,
  checkCancel: () => boolean,
) {
  const { Output, Mp4OutputFormat, WebMOutputFormat, MkvOutputFormat, CanvasSource, StreamTarget } =
    await import('mediabunny');

  const localCompositor = new VideoCompositor();
  await localCompositor.init(options.width, options.height, '#000', true);

  try {
    const maxVideoDurationUs = await localCompositor.loadTimeline(timelineClips, async (path) => {
      if (!hostClient) return null;
      return hostClient.getFileHandleByPath(path);
    });

    const maxAudioDurationUs = audioClips.reduce((max, clip) => {
      const endUs =
        Number(clip.timelineRange?.startUs || 0) + Number(clip.timelineRange?.durationUs || 0);
      return Math.max(max, endUs);
    }, 0);

    const maxDurationUs = Math.max(maxVideoDurationUs, maxAudioDurationUs);

    if (maxDurationUs <= 0) throw new Error('No clips to export');

    const durationS = maxDurationUs / 1_000_000;
    const hasAnyAudio = audioClips.length > 0;

    const format =
      options.format === 'webm'
        ? new WebMOutputFormat()
        : options.format === 'mkv'
          ? new MkvOutputFormat()
          : new Mp4OutputFormat();

    async function runExportWithHardwareAcceleration(
      preference: 'prefer-hardware' | 'prefer-software',
    ) {
      if (hostClient) {
        try {
          await (hostClient as any).onExportPhase?.('encoding');
        } catch {
          // ignore
        }
      }

      const writable = await (targetHandle as any).createWritable({ keepExistingData: false });

      const target = new StreamTarget(writable, {
        chunked: true,
        chunkSize: 16 * 1024 * 1024,
      });
      const output = new Output({ target, format });

      const videoSource = new CanvasSource(localCompositor.canvas as any, {
        codec: getBunnyVideoCodec(options.videoCodec),
        bitrate: options.bitrate,
        hardwareAcceleration: preference,
      });
      output.addVideoTrack(videoSource);

      let audioSource: any = null;
      let audioSamples: Array<{ data: Float32Array; timestamp: number }> | null = null;
      let audioSampleRate = 48000;
      let audioNumberOfChannels = 2;
      if (options.audio && hasAnyAudio) {
        const audioTrack = await buildMixedAudioTrack(
          options,
          audioClips,
          durationS,
          hostClient,
          reportExportWarning,
        );
        if (audioTrack) {
          audioSource = audioTrack.audioSource;
          audioSamples = audioTrack.samples;
          audioSampleRate = audioTrack.sampleRate;
          audioNumberOfChannels = audioTrack.numberOfChannels;
          output.addAudioTrack(audioSource);
        } else {
          await reportExportWarning(
            '[Worker Export] No decodable audio track found; exporting without audio.',
          );
        }
      }

      const fps = Math.max(1, Math.round(Number(options.fps) || 30));
      const totalFrames = Math.ceil(durationS * fps);
      const dtUs = Math.floor(1_000_000 / fps);
      const dtS = dtUs / 1_000_000;
      let currentTimeUs = 0;

      let lastYieldAtMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
      let lastProgressAtMs = lastYieldAtMs;
      const yieldIntervalMs = 16;
      const progressIntervalMs = 250;

      try {
        await output.start();

        if (audioSource && audioSamples) {
          const { AudioSample } = await import('mediabunny');
          for (const sampleInfo of audioSamples) {
            const sample = new AudioSample({
              data: sampleInfo.data,
              format: 'f32-planar',
              numberOfChannels: audioNumberOfChannels,
              sampleRate: audioSampleRate,
              timestamp: sampleInfo.timestamp,
            });
            try {
              await audioSource.add(sample);
            } finally {
              if (typeof sample.close === 'function') sample.close();
            }
          }
        }

        for (let frameNum = 0; frameNum < totalFrames; frameNum++) {
          if (checkCancel()) {
            const abortErr = new Error('Export was cancelled');
            (abortErr as any).name = 'AbortError';
            throw abortErr;
          }
          const generatedCanvas = await localCompositor.renderFrame(currentTimeUs);
          if (generatedCanvas) {
            await (videoSource as any).add(currentTimeUs / 1_000_000, dtS);
          }
          currentTimeUs += dtUs;

          const progress = Math.min(100, Math.round(((frameNum + 1) / totalFrames) * 100));
          const nowProgressMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
          const shouldReport =
            frameNum + 1 === totalFrames || nowProgressMs - lastProgressAtMs >= progressIntervalMs;
          if (hostClient && shouldReport) {
            lastProgressAtMs = nowProgressMs;
            await hostClient.onExportProgress(progress);
          }

          const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
          if (nowMs - lastYieldAtMs >= yieldIntervalMs) {
            lastYieldAtMs = nowMs;
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          }
        }

        if ('close' in videoSource) (videoSource as any).close();
        if (audioSource && 'close' in audioSource) (audioSource as any).close();

        if (hostClient) {
          try {
            await (hostClient as any).onExportPhase?.('saving');
          } catch {
            // ignore
          }
        }

        await output.finalize();
      } catch (e) {
        try {
          if (typeof (output as any).cancel === 'function') {
            await (output as any).cancel();
          }
        } catch {
          // ignore
        }

        try {
          if (typeof (writable as any).abort === 'function') {
            await (writable as any).abort();
          }
        } catch {
          // ignore
        }
        throw e;
      }
    }

    try {
      await runExportWithHardwareAcceleration('prefer-hardware');
    } catch (e) {
      console.warn(
        '[Worker Export] Hardware acceleration export failed, retrying with software',
        e,
      );
      await runExportWithHardwareAcceleration('prefer-software');
    }
  } finally {
    localCompositor.destroy();
  }
}
