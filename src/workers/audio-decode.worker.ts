import { AudioSampleSink, BlobSource, Input, ALL_FORMATS } from 'mediabunny';

interface DecodeRequest {
  type: 'decode' | 'extract-peaks';
  id: number;
  sourceKey: string;
  arrayBuffer: ArrayBuffer;
  options?: {
    maxLength?: number;
    precision?: number;
  };
}

interface DecodeResponse {
  type: 'decode-result';
  id: number;
  ok: boolean;
  error?: { name?: string; message: string; stack?: string };
  result?: {
    sampleRate: number;
    numberOfChannels: number;
    channelBuffers: ArrayBuffer[];
    peaks?: number[][];
  };
}

async function decodeToFloat32Channels(arrayBuffer: ArrayBuffer) {
  const blob = new Blob([arrayBuffer]);
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

function extractPeaks(
  channelBuffers: ArrayBuffer[],
  options?: { maxLength?: number; precision?: number },
): number[][] {
  const maxLength = options?.maxLength || 8000;
  const precision = options?.precision || 10000;
  const peaks: number[][] = [];

  for (const buffer of channelBuffers) {
    const channel = new Float32Array(buffer);
    const data: number[] = [];
    const sampleSize = channel.length / maxLength;

    for (let j = 0; j < maxLength; j++) {
      const start = Math.floor(j * sampleSize);
      const end = Math.ceil((j + 1) * sampleSize);
      let max = 0;

      for (let x = start; x < end && x < channel.length; x++) {
        const n = channel[x];
        if (n !== undefined && Math.abs(n) > Math.abs(max)) {
          max = n;
        }
      }
      data.push(Math.round(max * precision) / precision);
    }
    peaks.push(data);
  }

  return peaks;
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
    const result = await decodeToFloat32Channels(data.arrayBuffer);

    let peaks: number[][] | undefined;
    if (data.type === 'extract-peaks') {
      peaks = extractPeaks(result.channelBuffers, data.options);
    }

    response.ok = true;
    response.result = {
      ...result,
      peaks,
    };

    (self as any).postMessage(response, [...result.channelBuffers]);
  } catch (err: any) {
    response.ok = false;
    response.error = {
      name: err?.name,
      message: err?.message || String(err),
      stack: err?.stack,
    };
    (self as any).postMessage(response);
  }
});
