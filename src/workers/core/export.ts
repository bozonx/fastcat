import type { VideoCoreHostAPI } from '../../utils/video-editor/worker-client';
import { VideoCompositor } from '../../utils/video-editor/VideoCompositor';
import { safeDispose } from '../../utils/video-editor/utils';
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

  try {
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
      safeDispose(input);
    }
  } catch (err) {
    console.error('[Worker Export] Failed to extract metadata:', err);
    throw err;
  }
}

function isOpusCodec(codec: string | undefined): boolean {
  const value = String(codec ?? '').toLowerCase();
  return value.startsWith('opus');
}

function getClipRanges(clip: any) {
  const timelineStartUs = Number(clip.timelineRange?.startUs || 0);
  const timelineDurationUs = Number(clip.timelineRange?.durationUs || 0);
  const sourceStartUs = Number(clip.sourceRange?.startUs || 0);
  const sourceDurationUs = Number(clip.sourceRange?.durationUs || timelineDurationUs || 0);

  const timelineStartS = Math.max(0, timelineStartUs / 1_000_000);
  const sourceStartS = Math.max(0, sourceStartUs / 1_000_000);
  const durationS = Math.max(0, sourceDurationUs / 1_000_000);

  return {
    timelineStartS,
    sourceStartS,
    sourceEndS: sourceStartS + durationS,
  };
}

async function buildPassthroughAudioTrack(params: {
  clip: any;
  hostClient: VideoCoreHostAPI | null;
  reportExportWarning: (message: string) => Promise<void>;
}) {
  const { clip, hostClient, reportExportWarning } = params;
  const sourcePath = clip.sourcePath || clip.source?.path;
  if (!sourcePath || !hostClient) return null;

  const fileHandle = clip.fileHandle || (await hostClient.getFileHandleByPath(sourcePath));
  if (!fileHandle) return null;

  const file = await fileHandle.getFile();
  const { Input, BlobSource, ALL_FORMATS, EncodedPacketSink, EncodedAudioPacketSource } =
    await import('mediabunny');
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS } as any);

  try {
    const audioTrack = await input.getPrimaryAudioTrack();
    if (!audioTrack) return null;

    const codecParam = await audioTrack.getCodecParameterString();
    const codec = codecParam || audioTrack.codec || '';
    if (!isOpusCodec(codec)) return null;

    const decoderConfig = await audioTrack.getDecoderConfig();
    if (!decoderConfig) {
      await reportExportWarning(
        '[Worker Export] Opus audio passthrough requires decoder config; falling back to re-encode.',
      );
      return null;
    }

    return {
      audioSource: new EncodedAudioPacketSource('opus'),
      packetSink: new EncodedPacketSink(audioTrack),
      decoderConfig,
      ranges: getClipRanges(clip),
      input,
    } as const;
  } catch (error) {
    await reportExportWarning('[Worker Export] Failed to build Opus passthrough audio track.');
    throw error;
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
    const maxVideoDurationUs = await localCompositor.loadTimeline(
      timelineClips,
      async (path) => {
        if (!hostClient) return null;
        return hostClient.getFileHandleByPath(path);
      },
      checkCancel,
    );

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
      fallbackCodecString = true,
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

      const fullCodecString =
        fallbackCodecString && options.videoCodec ? options.videoCodec : undefined;

      const videoSource = new CanvasSource(localCompositor.canvas as any, {
        codec: getBunnyVideoCodec(options.videoCodec),
        fullCodecString,
        bitrate: options.bitrate,
        hardwareAcceleration: preference,
      });
      output.addVideoTrack(videoSource);

      let audioSource: any = null;
      let writeMixedAudioToSource: (() => Promise<void>) | null = null;
      let audioSampleRate = 48000;
      let audioNumberOfChannels = 2;
      let audioPacketState: {
        audioSource: any;
        packetSink: any;
        decoderConfig: any;
        ranges: { timelineStartS: number; sourceStartS: number; sourceEndS: number };
        input: any;
      } | null = null;
      if (options.audio && hasAnyAudio) {
        if (options.audioPassthrough && audioClips.length === 1) {
          audioPacketState = await buildPassthroughAudioTrack({
            clip: audioClips[0],
            hostClient,
            reportExportWarning,
          });
          if (audioPacketState) {
            audioSource = audioPacketState.audioSource;
            output.addAudioTrack(audioSource);
          } else {
            await reportExportWarning(
              '[Worker Export] Opus audio passthrough not available; falling back to re-encode.',
            );
          }
        }

        if (!audioSource) {
          const audioTrack = await buildMixedAudioTrack(
            options,
            audioClips,
            durationS,
            hostClient,
            reportExportWarning,
            checkCancel,
          );
          if (audioTrack) {
            audioSource = audioTrack.audioSource;
            writeMixedAudioToSource = audioTrack.writeMixedToSource;
            audioSampleRate = audioTrack.sampleRate;
            audioNumberOfChannels = audioTrack.numberOfChannels;
            output.addAudioTrack(audioSource);
          } else {
            await reportExportWarning(
              '[Worker Export] No decodable audio track found; exporting without audio.',
            );
          }
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

        if (audioPacketState) {
          const { packetSink, decoderConfig, ranges, input } = audioPacketState;
          let isFirstPacket = true;
          try {
            for await (const packet of packetSink.packets()) {
              if (checkCancel()) {
                const abortErr = new Error('Export was cancelled');
                (abortErr as any).name = 'AbortError';
                throw abortErr;
              }
              const packetStart = Number(packet.timestamp || 0);
              const packetDuration = Number(packet.duration || 0);
              const packetEnd = packetStart + packetDuration;
              if (packetEnd <= ranges.sourceStartS) continue;
              if (packetStart >= ranges.sourceEndS) break;

              const adjustedTimestamp = packetStart - ranges.sourceStartS + ranges.timelineStartS;
              const adjustedPacket = packet.clone({ timestamp: adjustedTimestamp });
              if (isFirstPacket) {
                await audioPacketState.audioSource.add(adjustedPacket, { decoderConfig });
                isFirstPacket = false;
              } else {
                await audioPacketState.audioSource.add(adjustedPacket);
              }
            }

            if (isFirstPacket) {
              await reportExportWarning(
                '[Worker Export] No audio packets in selected range; exporting without audio.',
              );
            }
          } finally {
            if ('close' in packetSink && typeof (packetSink as any).close === 'function') {
              (packetSink as any).close();
            }
            safeDispose(input);
          }
        }

        if (audioSource && writeMixedAudioToSource) {
          await writeMixedAudioToSource();
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
      await runExportWithHardwareAcceleration('prefer-hardware', true);
    } catch (e) {
      console.warn(
        '[Worker Export] Hardware acceleration export with exact profile failed, retrying with default HW profile',
        e,
      );
      try {
        await runExportWithHardwareAcceleration('prefer-hardware', false);
      } catch (e2) {
        console.warn(
          '[Worker Export] Hardware acceleration export failed completely, retrying with software',
          e2,
        );
        await runExportWithHardwareAcceleration('prefer-software', false);
      }
    }
  } finally {
    localCompositor.destroy();
  }
}
