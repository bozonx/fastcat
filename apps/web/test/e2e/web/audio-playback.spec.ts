import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeFileToOpfs } from '../../utils/e2e/virtual-fs';
import { playAudioSample, probeAudioFile, waitForAudioProbe } from '../../utils/e2e/audio';

const AUDIO_FIXTURE = resolve(process.cwd(), 'test/fixtures/media/audio/audio-sine.wav');

test.describe('Web audio playback', () => {
  test('decodes an OPFS audio file and measures a muted WebAudio graph', async ({ page }) => {
    const opfsPath = 'audio-e2e/audio-sine.wav';
    const bytes = readFileSync(AUDIO_FIXTURE);

    await page.goto('/test/audio-probe');
    await waitForAudioProbe(page);
    await writeFileToOpfs(page, { path: opfsPath, data: new Uint8Array(bytes) });

    const decoded = await probeAudioFile(page, opfsPath);

    expect(decoded.ok, decoded.error).toBe(true);
    expect(decoded.durationSec).toBeGreaterThan(0.9);
    expect(decoded.sampleRate).toBeGreaterThan(0);
    expect(decoded.channels).toBeGreaterThan(0);
    expect(decoded.rms).toBeGreaterThan(0.01);
    expect(decoded.peak).toBeGreaterThan(0.05);

    const mutedPlayback = await playAudioSample(page, {
      path: opfsPath,
      masterGain: 0,
      durationMs: 300,
    });

    expect(mutedPlayback.ok, mutedPlayback.error).toBe(true);
    expect(mutedPlayback.contextState).toBe('running');
    expect(mutedPlayback.inputRms).toBeGreaterThan(0.005);
    expect(mutedPlayback.inputPeak).toBeGreaterThan(0.02);
    expect(mutedPlayback.outputRms).toBeLessThan(0.005);
    expect(mutedPlayback.outputPeak).toBeLessThan(0.02);
  });
});
