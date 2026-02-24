import type { VideoCoreHostAPI } from '../../utils/video-editor/worker-client';
import { MAX_AUDIO_FILE_BYTES } from '../../utils/constants';
import { clampFloat32, getBunnyAudioCodec } from './utils';

export async function buildMixedAudioTrack(
  options: any,
  audioClips: any[],
  durationS: number,
  hostClient: VideoCoreHostAPI | null,
  reportExportWarning: (message: string) => Promise<void>,
  checkCancel?: () => boolean,
) {
  const { AudioSampleSink, AudioSampleSource, Input, BlobSource, ALL_FORMATS } =
    await import('mediabunny');

  const sampleRate = 48000;
  const numberOfChannels = 2;

  const chunkDurationS = 1;
  const chunkFrames = sampleRate * chunkDurationS;
  const totalFrames = Math.ceil(durationS * sampleRate);
  const totalChunks = Math.max(1, Math.ceil(totalFrames / chunkFrames));

  interface PreparedClip {
    clipStartS: number;
    offsetS: number;
    playDurationS: number;
    input: any;
    sink: any;
    sourcePath: string;
  }

  const prepared: PreparedClip[] = [];

  for (const clipData of audioClips) {
    if (checkCancel?.()) {
      const abortErr = new Error('Export was cancelled');
      (abortErr as any).name = 'AbortError';
      throw abortErr;
    }

    const sourcePath = clipData.sourcePath || clipData.source?.path;
    if (!sourcePath) continue;

    let fileHandle: FileSystemFileHandle | null = clipData.fileHandle || null;
    if (!fileHandle && hostClient) {
      fileHandle = await hostClient.getFileHandleByPath(sourcePath);
    }
    if (!fileHandle) continue;

    let file: File;
    try {
      file = await fileHandle.getFile();
    } catch {
      await reportExportWarning('[Worker Export] Failed to read audio file handle');
      continue;
    }

    if (file.size > MAX_AUDIO_FILE_BYTES) {
      await reportExportWarning(
        '[Worker Export] Audio file is too large to decode in memory; skipping audio clip.',
      );
      continue;
    }

    const startUs = clipData.startUs ?? clipData.timelineRange?.startUs ?? 0;
    const sourceStartUs = clipData.sourceStartUs ?? clipData.sourceRange?.startUs ?? 0;
    const sourceDurationUs = clipData.sourceDurationUs ?? clipData.sourceRange?.durationUs ?? 0;
    const durationUs = clipData.durationUs ?? clipData.timelineRange?.durationUs ?? 0;

    const clipStartS = Math.max(0, Number(startUs) / 1_000_000);
    const rawOffsetS = Math.max(0, Number(sourceStartUs) / 1_000_000);
    const sourceDurationS = Math.max(0, Number(sourceDurationUs) / 1_000_000);
    const timelineDurationS = Math.max(0, Number(durationUs) / 1_000_000);
    const clipDurationS = Math.max(
      0,
      Math.min(sourceDurationS || Number.POSITIVE_INFINITY, timelineDurationS || sourceDurationS),
    );
    if (clipDurationS <= 0) continue;

    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS } as any);
    try {
      const aTrack = await input.getPrimaryAudioTrack();
      if (!aTrack) {
        if ('dispose' in input && typeof (input as any).dispose === 'function')
          (input as any).dispose();
        else if ('close' in input && typeof (input as any).close === 'function')
          (input as any).close();
        continue;
      }
      if (!(await aTrack.canDecode())) {
        if ('dispose' in input && typeof (input as any).dispose === 'function')
          (input as any).dispose();
        else if ('close' in input && typeof (input as any).close === 'function')
          (input as any).close();
        continue;
      }

      const sink = new AudioSampleSink(aTrack);

      const offsetS = Math.max(0, rawOffsetS);
      const trackDurationS = (aTrack as any).duration;
      const maxPlayableS = Math.max(
        0,
        (Number.isFinite(trackDurationS) ? Number(trackDurationS) : Number.POSITIVE_INFINITY) -
          offsetS,
      );
      const playDurationS = Math.min(clipDurationS, maxPlayableS);
      if (playDurationS <= 0) {
        if (typeof (sink as any).close === 'function') (sink as any).close();
        if (typeof (sink as any).dispose === 'function') (sink as any).dispose();
        if ('dispose' in input && typeof (input as any).dispose === 'function')
          (input as any).dispose();
        else if ('close' in input && typeof (input as any).close === 'function')
          (input as any).close();
        continue;
      }

      prepared.push({ clipStartS, offsetS, playDurationS, input, sink, sourcePath });
    } catch (err) {
      console.warn('[Worker Export] Failed to decode audio clip', err);
      await reportExportWarning('[Worker Export] Failed to decode audio clip');
      if ('dispose' in input && typeof (input as any).dispose === 'function')
        (input as any).dispose();
      else if ('close' in input && typeof (input as any).close === 'function')
        (input as any).close();
    }
  }

  if (prepared.length === 0) return null;

  const audioSource = new AudioSampleSource({
    codec: getBunnyAudioCodec(options.audioCodec),
    bitrate: options.audioBitrate,
  });

  async function writeMixedToSource() {
    const { AudioSample } = await import('mediabunny');

    try {
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
        if (checkCancel?.()) {
          const abortErr = new Error('Export was cancelled');
          (abortErr as any).name = 'AbortError';
          throw abortErr;
        }

        const chunkStartS = chunkIndex * chunkDurationS;
        const chunkEndS = Math.min(durationS, chunkStartS + chunkDurationS);
        const framesInChunk = Math.min(chunkFrames, totalFrames - chunkIndex * chunkFrames);
        if (framesInChunk <= 0) continue;

        const mixedInterleaved = new Float32Array(framesInChunk * numberOfChannels);

        for (const clip of prepared) {
          if (checkCancel?.()) {
            const abortErr = new Error('Export was cancelled');
            (abortErr as any).name = 'AbortError';
            throw abortErr;
          }

          const clipGlobalStartS = clip.clipStartS;
          const clipGlobalEndS = clip.clipStartS + clip.playDurationS;
          const overlapStartS = Math.max(chunkStartS, clipGlobalStartS);
          const overlapEndS = Math.min(chunkEndS, clipGlobalEndS);
          if (overlapEndS <= overlapStartS) continue;

          const clipLocalStartS = overlapStartS - clipGlobalStartS;
          const clipLocalEndS = overlapEndS - clipGlobalStartS;
          const sinkStartS = clip.offsetS + clipLocalStartS;
          const sinkEndS = clip.offsetS + clipLocalEndS;

          try {
            for await (const sampleRaw of (clip.sink as any).samples(sinkStartS, sinkEndS)) {
              const sample = sampleRaw as any;
              try {
                const frames = Number(sample.numberOfFrames) || 0;
                const sr = Number(sample.sampleRate) || 0;
                const ch = Number(sample.numberOfChannels) || 0;

                if (frames <= 0) continue;
                if (sr !== sampleRate || ch !== numberOfChannels) {
                  await reportExportWarning(
                    '[Worker Export] Audio clip sample format mismatch; skipping some audio.',
                  );
                  continue;
                }

                const timelineTimeS = clip.clipStartS + (Number(sample.timestamp) - clip.offsetS);
                if (!Number.isFinite(timelineTimeS)) continue;

                const startFrameGlobal = Math.floor(timelineTimeS * sampleRate);
                const startFrameInChunkGlobal = Math.floor(chunkStartS * sampleRate);
                const writeOffsetFrames = startFrameGlobal - startFrameInChunkGlobal;
                if (writeOffsetFrames >= framesInChunk) continue;

                const tmpPlanes: Float32Array[] = [];
                for (let planeIndex = 0; planeIndex < numberOfChannels; planeIndex += 1) {
                  const bytesNeeded = sample.allocationSize({
                    format: 'f32-planar',
                    planeIndex,
                  });
                  const plane = new Float32Array(bytesNeeded / 4);
                  sample.copyTo(plane, { format: 'f32-planar', planeIndex });
                  tmpPlanes.push(plane);
                }

                for (let i = 0; i < frames; i += 1) {
                  const dstFrame = writeOffsetFrames + i;
                  if (dstFrame < 0) continue;
                  if (dstFrame >= framesInChunk) break;
                  for (let c = 0; c < numberOfChannels; c += 1) {
                    const plane = tmpPlanes[c];
                    const v = plane ? (plane[i] ?? 0) : 0;
                    const idx = dstFrame * numberOfChannels + c;
                    mixedInterleaved[idx] = clampFloat32(mixedInterleaved[idx]! + v);
                  }
                }
              } finally {
                if (typeof sample.close === 'function') sample.close();
              }
            }
          } catch (err) {
            console.warn('[Worker Export] Failed to decode audio clip chunk', err);
            await reportExportWarning('[Worker Export] Failed to decode audio clip');
          }
        }

        const planar = new Float32Array(framesInChunk * numberOfChannels);
        for (let i = 0; i < framesInChunk; i += 1) {
          planar[i] = mixedInterleaved[i * 2] ?? 0;
          planar[i + framesInChunk] = mixedInterleaved[i * 2 + 1] ?? 0;
        }

        const audioSample = new AudioSample({
          data: planar,
          format: 'f32-planar',
          numberOfChannels,
          sampleRate,
          timestamp: chunkStartS,
        });

        try {
          await (audioSource as any).add(audioSample);
        } finally {
          if (typeof audioSample.close === 'function') audioSample.close();
        }
      }
    } finally {
      for (const clip of prepared) {
        try {
          if (typeof (clip.sink as any).close === 'function') (clip.sink as any).close();
          if (typeof (clip.sink as any).dispose === 'function') (clip.sink as any).dispose();
        } catch {
          // ignore
        }
        try {
          if ('dispose' in clip.input && typeof (clip.input as any).dispose === 'function')
            (clip.input as any).dispose();
          else if ('close' in clip.input && typeof (clip.input as any).close === 'function')
            (clip.input as any).close();
        } catch {
          // ignore
        }
      }
    }
  }

  return {
    audioSource,
    writeMixedToSource,
    numberOfChannels,
    sampleRate,
  };
}
