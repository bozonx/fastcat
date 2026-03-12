import { AudioSampleSink, BlobSource, Input, ALL_FORMATS } from 'mediabunny';

import type { DecodeRequest, DecodeResponse } from '../utils/audio/types';

async function decodeToFloat32Channels(source: Blob | ArrayBuffer) {
  const blob = source instanceof Blob ? source : new Blob([source]);
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS } as any);

  try {
    const aTrack = await input.getPrimaryAudioTrack();
    if (!aTrack) {
      const err = new Error('No audio track');
      (err as any).name = 'NoAudioTrackError';
      throw err;
    }
    if (!(await aTrack.canDecode())) throw new Error('Audio track cannot be decoded');

    const sink = new AudioSampleSink(aTrack);
    try {
      const metaDurationS = await input.computeDuration();
      const durationS = Number.isFinite(metaDurationS) && metaDurationS > 0 ? metaDurationS : 0;

      let sampleRate = 48000;
      let numberOfChannels = 2;

      const channelChunks: Float32Array[][] = [];
      let totalFrames = 0;

      for await (const sampleRaw of (sink as any).samples(0, durationS || 1e9)) {
        const sample = sampleRaw as any;
        try {
          sampleRate = sample.sampleRate;
          numberOfChannels = sample.numberOfChannels;

          if (channelChunks.length !== numberOfChannels) {
            channelChunks.length = 0;
            for (let ch = 0; ch < numberOfChannels; ch += 1) channelChunks.push([]);
            totalFrames = 0;
          }

          const frames = Number(sample.numberOfFrames) || 0;
          if (frames > 0) {
            for (let ch = 0; ch < numberOfChannels; ch += 1) {
              const bytesNeeded = sample.allocationSize({ format: 'f32-planar', planeIndex: ch });
              const chunk = new Float32Array(bytesNeeded / 4);
              sample.copyTo(chunk, { format: 'f32-planar', planeIndex: ch });
              if (chunk.length > 0) {
                channelChunks[ch]?.push(chunk);
              }
            }
            totalFrames += frames;
          }
        } finally {
          if (typeof sample.close === 'function') sample.close();
        }
      }

      if (totalFrames <= 0) throw new Error('Decoded audio is empty');

      const channelBuffers = channelChunks.map((chunks) => {
        const combined = new Float32Array(totalFrames);
        let offset = 0;
        for (const chunk of chunks) {
          if (!chunk.length) continue;
          combined.set(chunk, offset);
          offset += chunk.length;
        }
        return combined.buffer as ArrayBuffer;
      });

      return {
        sampleRate,
        numberOfChannels,
        channelBuffers,
      };
    } finally {
      if (typeof (sink as any).close === 'function') (sink as any).close();
      if (typeof (sink as any).dispose === 'function') (sink as any).dispose();
    }
  } finally {
    if ('dispose' in input && typeof (input as any).dispose === 'function')
      (input as any).dispose();
    else if ('close' in input && typeof (input as any).close === 'function') (input as any).close();
  }
}

async function extractPeaksFromSource(
  source: Blob | ArrayBuffer,
  options?: { maxLength?: number; precision?: number },
): Promise<number[][]> {
  const maxLength = options?.maxLength || 8000;
  const precision = options?.precision || 10000;
  const blob = source instanceof Blob ? source : new Blob([source]);
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS } as any);

  try {
    const aTrack = await input.getPrimaryAudioTrack();
    if (!aTrack) {
      const err = new Error('No audio track');
      (err as any).name = 'NoAudioTrackError';
      throw err;
    }
    if (!(await aTrack.canDecode())) throw new Error('Audio track cannot be decoded');

    const sink = new AudioSampleSink(aTrack);
    try {
      const metaDurationS = await input.computeDuration();
      const durationS = Number.isFinite(metaDurationS) && metaDurationS > 0 ? metaDurationS : 0;
      const totalFramesEstimate = Math.max(1, Math.ceil(durationS * 48000));
      const peaks: number[][] = [];
      const counts: Uint32Array[] = [];

      for await (const sampleRaw of (sink as any).samples(0, durationS || 1e9)) {
        const sample = sampleRaw as any;
        try {
          const frames = Number(sample.numberOfFrames) || 0;
          const numberOfChannels = Math.max(1, Number(sample.numberOfChannels) || 1);
          const sampleRate = Math.max(1, Number(sample.sampleRate) || 48000);
          if (frames <= 0) continue;

          if (peaks.length !== numberOfChannels) {
            peaks.length = 0;
            counts.length = 0;
            for (let ch = 0; ch < numberOfChannels; ch += 1) {
              peaks.push(Array.from({ length: maxLength }, () => 0));
              counts.push(new Uint32Array(maxLength));
            }
          }

          const timestampS = Number(sample.timestamp) || 0;
          const startFrame = Math.max(0, Math.floor(timestampS * sampleRate));
          const estimatedTotalFrames = Math.max(totalFramesEstimate, startFrame + frames);

          for (let ch = 0; ch < numberOfChannels; ch += 1) {
            const bytesNeeded = sample.allocationSize({ format: 'f32-planar', planeIndex: ch });
            const channel = new Float32Array(bytesNeeded / 4);
            sample.copyTo(channel, { format: 'f32-planar', planeIndex: ch });

            for (let i = 0; i < frames && i < channel.length; i += 1) {
              const globalFrame = startFrame + i;
              const bucket = Math.min(
                maxLength - 1,
                Math.max(0, Math.floor((globalFrame / estimatedTotalFrames) * maxLength)),
              );
              const value = channel[i] ?? 0;
              const current = peaks[ch]?.[bucket] ?? 0;
              if (Math.abs(value) > Math.abs(current)) {
                peaks[ch]![bucket] = value;
              }
              const channelCounts = counts[ch];
              if (channelCounts) {
                const currentCount = channelCounts[bucket] ?? 0;
                channelCounts[bucket] = currentCount + 1;
              }
            }
          }
        } finally {
          if (typeof sample.close === 'function') sample.close();
        }
      }

      if (peaks.length === 0) {
        throw new Error('Decoded audio is empty');
      }

      return peaks.map((channel) =>
        channel.map((value) => Math.round(value * precision) / precision),
      );
    } finally {
      if (typeof (sink as any).close === 'function') (sink as any).close();
      if (typeof (sink as any).dispose === 'function') (sink as any).dispose();
    }
  } finally {
    if ('dispose' in input && typeof (input as any).dispose === 'function')
      (input as any).dispose();
    else if ('close' in input && typeof (input as any).close === 'function') (input as any).close();
  }
}

self.addEventListener('message', async (event: MessageEvent<DecodeRequest>) => {
  const data = event.data;
  if (!data || (data.type !== 'decode' && data.type !== 'extract-peaks')) return;

  const response: DecodeResponse = {
    type: 'decode-result',
    id: data.id,
    ok: false,
  };

  try {
    if (data.type === 'extract-peaks') {
      const peaks = await extractPeaksFromSource(
        data.blob ?? data.arrayBuffer ?? new ArrayBuffer(0),
        data.options,
      );
      response.ok = true;
      response.result = {
        sampleRate: 48000,
        numberOfChannels: peaks.length,
        channelBuffers: [],
        peaks,
      };

      (self as any).postMessage(response);
      return;
    }

    const result = await decodeToFloat32Channels(
      data.arrayBuffer ?? data.blob ?? new ArrayBuffer(0),
    );

    response.ok = true;
    response.result = {
      ...result,
    };

    (self as any).postMessage(response, [...result.channelBuffers]);
  } catch (err: any) {
    let errName = err?.name;
    if (err?.message === 'Input has an unsupported or unrecognizable format.') {
      errName = 'UnsupportedFormatError';
    }
    response.ok = false;
    response.error = {
      name: errName,
      message: err?.message || String(err),
      stack: err?.stack,
    };
    (self as any).postMessage(response);
  }
});
