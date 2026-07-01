<script setup lang="ts">
definePageMeta({
  layout: 'embedded',
});

interface AudioPcmStats {
  rms: number;
  peak: number;
}

interface AudioDecodeProbeResult extends AudioPcmStats {
  ok: boolean;
  durationSec: number;
  sampleRate: number;
  channels: number;
  error?: string;
}

interface AudioPlaybackProbeOptions {
  path: string;
  masterGain?: number;
  durationMs?: number;
}

interface AudioPlaybackProbeResult {
  ok: boolean;
  inputRms: number;
  inputPeak: number;
  outputRms: number;
  outputPeak: number;
  contextState: AudioContextState;
  error?: string;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function readFileFromOpfs(path: string): Promise<File | null> {
  if (!path) return null;

  try {
    const root = await navigator.storage.getDirectory();
    const parts = path.split('/').filter(Boolean);
    let dir = root;

    for (let index = 0; index < parts.length - 1; index += 1) {
      dir = await dir.getDirectoryHandle(parts[index]!);
    }

    const handle = await dir.getFileHandle(parts[parts.length - 1]!);
    return await handle.getFile();
  } catch {
    return null;
  }
}

function measurePcm(buffer: AudioBuffer): AudioPcmStats {
  let sumSquares = 0;
  let count = 0;
  let peak = 0;

  for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
    const channel = buffer.getChannelData(channelIndex);

    for (let sampleIndex = 0; sampleIndex < channel.length; sampleIndex += 1) {
      const value = channel[sampleIndex] ?? 0;
      const absolute = Math.abs(value);
      sumSquares += value * value;
      count += 1;
      if (absolute > peak) peak = absolute;
    }
  }

  return {
    rms: count > 0 ? Math.sqrt(sumSquares / count) : 0,
    peak,
  };
}

function measureAnalyser(analyser: AnalyserNode): AudioPcmStats {
  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);

  let sumSquares = 0;
  let peak = 0;

  for (const byte of data) {
    const value = (byte - 128) / 128;
    const absolute = Math.abs(value);
    sumSquares += value * value;
    if (absolute > peak) peak = absolute;
  }

  return {
    rms: Math.sqrt(sumSquares / data.length),
    peak,
  };
}

async function decodeFromOpfs(path: string, context: AudioContext): Promise<AudioBuffer> {
  const file = await readFileFromOpfs(path);
  if (!file) {
    throw new Error('file not found in OPFS');
  }

  return await context.decodeAudioData(await file.arrayBuffer());
}

async function probeFile(path: string): Promise<AudioDecodeProbeResult> {
  const context = new AudioContext();

  try {
    const buffer = await decodeFromOpfs(path, context);
    const stats = measurePcm(buffer);

    return {
      ok: true,
      durationSec: buffer.duration,
      sampleRate: buffer.sampleRate,
      channels: buffer.numberOfChannels,
      rms: stats.rms,
      peak: stats.peak,
    };
  } catch (error) {
    return {
      ok: false,
      durationSec: 0,
      sampleRate: 0,
      channels: 0,
      rms: 0,
      peak: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await context.close().catch(() => {});
  }
}

async function playDecodedSample(
  options: AudioPlaybackProbeOptions,
): Promise<AudioPlaybackProbeResult> {
  const context = new AudioContext();

  try {
    const buffer = await decodeFromOpfs(options.path, context);
    const source = context.createBufferSource();
    const inputAnalyser = context.createAnalyser();
    const outputAnalyser = context.createAnalyser();
    const masterGain = context.createGain();
    const durationMs = options.durationMs ?? 300;

    inputAnalyser.fftSize = 2048;
    outputAnalyser.fftSize = 2048;
    masterGain.gain.value = options.masterGain ?? 1;
    source.buffer = buffer;

    source.connect(inputAnalyser);
    inputAnalyser.connect(masterGain);
    masterGain.connect(outputAnalyser);
    outputAnalyser.connect(context.destination);

    await context.resume();
    source.start();

    const startedAt = performance.now();
    let inputRms = 0;
    let inputPeak = 0;
    let outputRms = 0;
    let outputPeak = 0;

    while (performance.now() - startedAt < durationMs) {
      await wait(25);

      const input = measureAnalyser(inputAnalyser);
      const output = measureAnalyser(outputAnalyser);

      inputRms = Math.max(inputRms, input.rms);
      inputPeak = Math.max(inputPeak, input.peak);
      outputRms = Math.max(outputRms, output.rms);
      outputPeak = Math.max(outputPeak, output.peak);
    }

    source.stop();

    return {
      ok: true,
      inputRms,
      inputPeak,
      outputRms,
      outputPeak,
      contextState: context.state,
    };
  } catch (error) {
    return {
      ok: false,
      inputRms: 0,
      inputPeak: 0,
      outputRms: 0,
      outputPeak: 0,
      contextState: context.state,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await context.close().catch(() => {});
  }
}

onMounted(() => {
  (
    window as unknown as {
      __audioProbe: {
        probeFile: typeof probeFile;
        playDecodedSample: typeof playDecodedSample;
      };
    }
  ).__audioProbe = {
    probeFile,
    playDecodedSample,
  };
});
</script>

<template>
  <div class="flex h-screen items-center justify-center bg-neutral-900 text-neutral-100">
    <div class="text-center">
      <h1 class="text-xl font-bold">Audio Probe Test Page</h1>
      <p class="mt-2 text-sm text-neutral-400">window.__audioProbe is ready</p>
    </div>
  </div>
</template>
