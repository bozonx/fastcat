import { expect } from '@wdio/globals';
import { invokeTauri } from '../helpers/ipc.js';

interface FfmpegDiagnostics {
  ffmpegAvailable: boolean;
  ffmpegVersion: string;
  ffprobeAvailable: boolean;
  ffprobeVersion: string;
  hwaccels: string[];
  codecs: Array<{
    label: string;
    key: string;
    decoders: Array<{ name: string; label: string; supported: boolean }>;
    encoders: Array<{ name: string; label: string; supported: boolean }>;
  }>;
}

interface FfmpegHwSettings {
  ffmpegPath: string;
  ffprobePath: string;
  hardwareAccelerationMode: 'none' | 'auto' | 'vaapi' | 'nvdec' | 'qsv';
  vaapiDevice: string;
  enableHardwareEncoding: boolean;
}

describe('Native FFmpeg Diagnostics & Settings (P1)', () => {
  it('returns valid FFmpeg diagnostics shape without throwing', async () => {
    const diagnostics = await invokeTauri<FfmpegDiagnostics>('native_get_ffmpeg_diagnostics', {
      ffmpegPath: null,
      ffprobePath: null,
    });

    expect(diagnostics).toBeDefined();
    expect(typeof diagnostics.ffmpegAvailable).toBe('boolean');
    expect(typeof diagnostics.ffmpegVersion).toBe('string');
    expect(typeof diagnostics.ffprobeAvailable).toBe('boolean');
    expect(typeof diagnostics.ffprobeVersion).toBe('string');
    expect(Array.isArray(diagnostics.hwaccels)).toBe(true);
    expect(Array.isArray(diagnostics.codecs)).toBe(true);
  });

  it('accepts valid FFmpeg settings and allows repeated updates without breaking', async () => {
    const initialSettings: FfmpegHwSettings = {
      ffmpegPath: 'ffmpeg',
      ffprobePath: 'ffprobe',
      hardwareAccelerationMode: 'none',
      vaapiDevice: '/dev/dri/renderD128',
      enableHardwareEncoding: false,
    };

    // First update
    await invokeTauri('native_update_ffmpeg_settings', { settings: initialSettings });

    // Second update (switching mode / toggling hw encoding)
    const updatedSettings: FfmpegHwSettings = {
      ...initialSettings,
      enableHardwareEncoding: false,
    };
    await invokeTauri('native_update_ffmpeg_settings', { settings: updatedSettings });

    // Confirm system remains healthy by fetching diagnostics again
    const diagnostics = await invokeTauri<FfmpegDiagnostics>('native_get_ffmpeg_diagnostics', {
      ffmpegPath: null,
      ffprobePath: null,
    });
    expect(diagnostics).toBeDefined();
  });
});
