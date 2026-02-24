import type { VideoCoreHostAPI } from '../../utils/video-editor/worker-client';
import { MAX_AUDIO_FILE_BYTES } from '../../utils/constants';
import { clampFloat32, getBunnyAudioCodec } from './utils';

export async function buildMixedAudioTrack(
  options: any,
  audioClips: any[],
  durationS: number,
  hostClient: VideoCoreHostAPI | null,
  reportExportWarning: (message: string) => Promise<void>,
) {
  const { AudioSampleSink, AudioSampleSource, Input, BlobSource, ALL_FORMATS } =
    await import('mediabunny');

  const sampleRate = 48000;
  const numberOfChannels = 2;

  const chunkDurationS = 1;
  const chunkFrames = sampleRate * chunkDurationS;

  const chunks = new Map<number, Float32Array>();

  async function getOrCreateChunk(index: number) {
    const existing = chunks.get(index);
    if (existing) return existing;
    const buf = new Float32Array(chunkFrames * numberOfChannels);
    chunks.set(index, buf);
    return buf;
  }

  for (const clipData of audioClips) {
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

    const clipStartS = Math.max(0, startUs / 1_000_000);
    const rawOffsetS = Math.max(0, sourceStartUs / 1_000_000);
    const sourceDurationS = Math.max(0, sourceDurationUs / 1_000_000);
    const timelineDurationS = Math.max(0, durationUs / 1_000_000);
    const clipDurationS = Math.max(
      0,
      Math.min(sourceDurationS || Number.POSITIVE_INFINITY, timelineDurationS || sourceDurationS),
    );

    if (clipDurationS <= 0) continue;

    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS } as any);
    try {
      const aTrack = await input.getPrimaryAudioTrack();
      if (!aTrack) continue;
      if (!(await aTrack.canDecode())) continue;

      const sink = new AudioSampleSink(aTrack);
      try {
        const offsetS = Math.max(0, rawOffsetS);
        const trackDurationS = (aTrack as any).duration;
        const maxPlayableS = Math.max(
          0,
          (Number.isFinite(trackDurationS) ? Number(trackDurationS) : Number.POSITIVE_INFINITY) -
            offsetS,
        );
        const playDurationS = Math.min(clipDurationS, maxPlayableS);
        if (playDurationS <= 0) continue;

        for await (const sampleRaw of (sink as any).samples(offsetS, offsetS + playDurationS)) {
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

            const localTimeS = Number(sample.timestamp) - offsetS;
            const timelineTimeS = clipStartS + localTimeS;
            if (!Number.isFinite(timelineTimeS)) continue;
            if (timelineTimeS < 0 || timelineTimeS > durationS) continue;

            const startFrameGlobal = Math.floor(timelineTimeS * sampleRate);
            const endFrameGlobal = startFrameGlobal + frames;
            if (endFrameGlobal <= 0) continue;

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
              const globalFrame = startFrameGlobal + i;
              if (globalFrame < 0) continue;
              if (globalFrame >= Math.floor(durationS * sampleRate)) break;

              const chunkIndex = Math.floor(globalFrame / chunkFrames);
              const chunk = await getOrCreateChunk(chunkIndex);
              const frameInChunk = globalFrame - chunkIndex * chunkFrames;
              if (frameInChunk < 0 || frameInChunk >= chunkFrames) continue;

              for (let c = 0; c < numberOfChannels; c += 1) {
                const plane = tmpPlanes[c];
                const v = plane ? (plane[i] ?? 0) : 0;
                const idx = frameInChunk * numberOfChannels + c;
                if (chunk) {
                  chunk[idx] = clampFloat32(chunk[idx]! + v);
                }
              }
            }
          } finally {
            if (typeof sample.close === 'function') sample.close();
          }
        }
      } finally {
        if (typeof (sink as any).close === 'function') (sink as any).close();
        if (typeof (sink as any).dispose === 'function') (sink as any).dispose();
      }
    } catch (err) {
      console.warn('[Worker Export] Failed to decode audio clip', err);
      await reportExportWarning('[Worker Export] Failed to decode audio clip');
    } finally {
      if ('dispose' in input && typeof (input as any).dispose === 'function')
        (input as any).dispose();
      else if ('close' in input && typeof (input as any).close === 'function')
        (input as any).close();
    }
  }

  if (chunks.size === 0) return null;

  const audioSource = new AudioSampleSource({
    codec: getBunnyAudioCodec(options.audioCodec),
    bitrate: options.audioBitrate,
  });

  const samples: Array<{ data: Float32Array; timestamp: number }> = [];
  const totalFrames = Math.ceil(durationS * sampleRate);
  const totalChunks = Math.max(1, Math.ceil(totalFrames / chunkFrames));
  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    const chunk = chunks.get(chunkIndex) ?? new Float32Array(chunkFrames * numberOfChannels);
    const framesInChunk = Math.min(chunkFrames, totalFrames - chunkIndex * chunkFrames);
    if (framesInChunk <= 0) continue;

    const plane0 = new Float32Array(framesInChunk);
    const plane1 = new Float32Array(framesInChunk);
    for (let i = 0; i < framesInChunk; i += 1) {
      plane0[i] = chunk[i * 2] ?? 0;
      plane1[i] = chunk[i * 2 + 1] ?? 0;
    }

    const planar = new Float32Array(framesInChunk * 2);
    planar.set(plane0, 0);
    planar.set(plane1, framesInChunk);

    const timestamp = chunkIndex * chunkDurationS;
    samples.push({ data: planar, timestamp });
  }

  return {
    audioSource,
    samples,
    numberOfChannels,
    sampleRate,
  };
}
