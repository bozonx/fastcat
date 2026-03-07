import { Input, BlobSource, ALL_FORMATS, AudioSampleSink } from 'mediabunny';

/**
 * Creates a WAV header for a given audio configuration.
 */
export function createWavHeader(params: {
  sampleRate: number;
  numberOfChannels: number;
  bitDepth: number;
  totalDataLength?: number; // If known, otherwise uses a large value for streaming
}): Uint8Array {
  const { sampleRate, numberOfChannels, bitDepth, totalDataLength = 0x7fffffff } = params;
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);

  /* RIFF identifier */
  header.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  /* RIFF chunk length */
  view.setUint32(4, 36 + totalDataLength, true);
  /* RIFF type */
  header.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE"

  /* format chunk identifier */
  header.set([0x66, 0x6d, 0x74, 0x20], 12); // "fmt "
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (raw) */
  view.setUint16(20, 1, true); // PCM
  /* channel count */
  view.setUint16(22, numberOfChannels, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sample rate * block align) */
  view.setUint32(28, (sampleRate * numberOfChannels * bitDepth) / 8, true);
  /* block align (channel count * bytes per sample) */
  view.setUint16(32, (numberOfChannels * bitDepth) / 8, true);
  /* bits per sample */
  view.setUint16(34, bitDepth, true);

  /* data chunk identifier */
  header.set([0x64, 0x61, 0x74, 0x61], 36); // "data"
  /* data chunk length */
  view.setUint32(40, totalDataLength, true);

  return header;
}

/**
 * Converts Float32Array to Int16Array (16-bit PCM).
 */
export function floatTo16BitPcm(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const val = input[i] ?? 0;
    const s = Math.max(-1, Math.min(1, val));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return output;
}

/**
 * Extracts and streams audio from a file as a WAV stream.
 */
export async function createAudioStreamFromFile(file: File): Promise<{
  stream: ReadableStream<Uint8Array>;
  sampleRate: number;
  numberOfChannels: number;
}> {
  const source = new BlobSource(file);
  const input = new Input({ source, formats: ALL_FORMATS } as any);

  try {
    const audioTrack = await input.getPrimaryAudioTrack();
    if (!audioTrack) {
      throw new Error('No audio track found in file');
    }

    const durationS = await input.computeDuration();
    const sink = new AudioSampleSink(audioTrack);

    // We need sample rate and channels to create the WAV header.
    // We can get them from the first sample.
    let sampleRate = 0;
    let numberOfChannels = 0;
    const bitDepth = 16;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          let headerSent = false;

          for await (const sampleRaw of (sink as any).samples(0, durationS || 1e9)) {
            const sample = sampleRaw as any;
            try {
              if (!headerSent) {
                sampleRate = sample.sampleRate || 48000;
                numberOfChannels = sample.numberOfChannels || 2;
                const header = createWavHeader({ sampleRate, numberOfChannels, bitDepth });
                controller.enqueue(header);
                headerSent = true;
              }

              // Mediabunny samples can be planar or interleaved.
              // To make it simpler, we use 'f32-interleaved' if supported or manual interleaving.
              const bytesNeeded = sample.allocationSize({ format: 'f32-interleaved' });
              const f32View = new Float32Array(bytesNeeded / 4);
              sample.copyTo(f32View, { format: 'f32-interleaved' });

              const pcm16 = floatTo16BitPcm(f32View);
              controller.enqueue(new Uint8Array(pcm16.buffer));
            } finally {
              if (typeof sample.close === 'function') sample.close();
            }
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        } finally {
          if (typeof (sink as any).close === 'function') (sink as any).close();
          if (typeof (sink as any).dispose === 'function') (sink as any).dispose();
          if ('dispose' in input && typeof (input as any).dispose === 'function')
            (input as any).dispose();
          else if ('close' in input && typeof (input as any).close === 'function')
            (input as any).close();
        }
      },
    });

    // Wait for the first sample to get metadata
    const reader = stream.getReader();
    const firstChunk = await reader.read();
    reader.releaseLock();

    if (firstChunk.done || !firstChunk.value) {
      throw new Error('Failed to extract audio samples');
    }

    // Wrap the stream to include the first chunk we just read
    const finalStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(firstChunk.value);
        const sourceReader = stream.getReader();
        try {
          while (true) {
            const { done, value } = await sourceReader.read();
            if (done) break;
            controller.enqueue(value);
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        } finally {
          sourceReader.releaseLock();
        }
      },
    });

    return {
      stream: finalStream,
      sampleRate,
      numberOfChannels,
    };
  } catch (err) {
    if ('dispose' in input && typeof (input as any).dispose === 'function')
      (input as any).dispose();
    else if ('close' in input && typeof (input as any).close === 'function') (input as any).close();
    throw err;
  }
}
