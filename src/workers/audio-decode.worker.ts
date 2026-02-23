import { AudioSampleSink, BlobSource, Input, ALL_FORMATS } from 'mediabunny';

interface DecodeRequest {
  type: 'decode';
  id: number;
  sourceKey: string;
  arrayBuffer: ArrayBuffer;
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
  };
}

async function decodeToFloat32Channels(arrayBuffer: ArrayBuffer) {
  const blob = new Blob([arrayBuffer]);
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS } as any);

  try {
    const aTrack = await input.getPrimaryAudioTrack();
    if (!aTrack) throw new Error('No audio track');
    if (!(await aTrack.canDecode())) throw new Error('Audio track cannot be decoded');

    const sink = new AudioSampleSink(aTrack);
    try {
      const metaDurationS = await input.computeDuration();
      const durationS = Number.isFinite(metaDurationS) && metaDurationS > 0 ? metaDurationS : 0;

      let sampleRate = 48000;
      let numberOfChannels = 2;

      const channels: Float32Array[] = [];
      let totalFrames = 0;

      for await (const sampleRaw of (sink as any).samples(0, durationS || 1e9)) {
        const sample = sampleRaw as any;
        try {
          sampleRate = sample.sampleRate;
          numberOfChannels = sample.numberOfChannels;

          if (channels.length !== numberOfChannels) {
            channels.length = 0;
            for (let ch = 0; ch < numberOfChannels; ch += 1) channels.push(new Float32Array());
            totalFrames = 0;
          }

          const frames = Number(sample.numberOfFrames) || 0;
          if (frames > 0) {
            const nextTotal = totalFrames + frames;
            for (let ch = 0; ch < numberOfChannels; ch += 1) {
              const prev = channels[ch] ?? new Float32Array();
              const next = new Float32Array(nextTotal);
              next.set(prev, 0);
              const chunk = sample.copyChannel?.(ch) as Float32Array | undefined;
              if (chunk && chunk.length > 0) {
                next.set(chunk, totalFrames);
              }
              channels[ch] = next;
            }
            totalFrames = nextTotal;
          }
        } finally {
          if (typeof sample.close === 'function') sample.close();
        }
      }

      if (totalFrames <= 0) throw new Error('Decoded audio is empty');

      return {
        sampleRate,
        numberOfChannels,
        channelBuffers: channels.map((ch) => ch.buffer as ArrayBuffer),
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

self.addEventListener('message', async (event: MessageEvent<DecodeRequest>) => {
  const data = event.data;
  if (!data || data.type !== 'decode') return;

  const response: DecodeResponse = {
    type: 'decode-result',
    id: data.id,
    ok: false,
  };

  try {
    const result = await decodeToFloat32Channels(data.arrayBuffer);
    response.ok = true;
    response.result = result;

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
