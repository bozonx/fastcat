/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { createWavHeader, floatTo16BitPcm } from '~/utils/audio-streaming';

describe('createWavHeader', () => {
  it('produces a 44-byte header', () => {
    const header = createWavHeader({ sampleRate: 48000, numberOfChannels: 2, bitDepth: 16 });
    expect(header.length).toBe(44);
  });

  it('writes RIFF magic bytes', () => {
    const header = createWavHeader({ sampleRate: 48000, numberOfChannels: 2, bitDepth: 16 });
    expect(header[0]).toBe(0x52); // 'R'
    expect(header[1]).toBe(0x49); // 'I'
    expect(header[2]).toBe(0x46); // 'F'
    expect(header[3]).toBe(0x46); // 'F'
  });

  it('writes WAVE format identifier', () => {
    const header = createWavHeader({ sampleRate: 48000, numberOfChannels: 2, bitDepth: 16 });
    expect(header[8]).toBe(0x57); // 'W'
    expect(header[9]).toBe(0x41); // 'A'
    expect(header[10]).toBe(0x56); // 'V'
    expect(header[11]).toBe(0x45); // 'E'
  });

  it('writes fmt sub-chunk identifier', () => {
    const header = createWavHeader({ sampleRate: 48000, numberOfChannels: 2, bitDepth: 16 });
    expect(header[12]).toBe(0x66); // 'f'
    expect(header[13]).toBe(0x6d); // 'm'
    expect(header[14]).toBe(0x74); // 't'
    expect(header[15]).toBe(0x20); // ' '
  });

  it('writes data sub-chunk identifier', () => {
    const header = createWavHeader({ sampleRate: 48000, numberOfChannels: 2, bitDepth: 16 });
    expect(header[36]).toBe(0x64); // 'd'
    expect(header[37]).toBe(0x61); // 'a'
    expect(header[38]).toBe(0x74); // 't'
    expect(header[39]).toBe(0x61); // 'a'
  });

  it('writes PCM format code (1)', () => {
    const header = createWavHeader({ sampleRate: 48000, numberOfChannels: 2, bitDepth: 16 });
    const view = new DataView(header.buffer);
    expect(view.getUint16(20, true)).toBe(1);
  });

  it('writes correct channel count', () => {
    const stereo = createWavHeader({ sampleRate: 48000, numberOfChannels: 2, bitDepth: 16 });
    const view = new DataView(stereo.buffer);
    expect(view.getUint16(22, true)).toBe(2);

    const mono = createWavHeader({ sampleRate: 48000, numberOfChannels: 1, bitDepth: 16 });
    const monoView = new DataView(mono.buffer);
    expect(monoView.getUint16(22, true)).toBe(1);
  });

  it('writes correct sample rate', () => {
    const header = createWavHeader({ sampleRate: 44100, numberOfChannels: 2, bitDepth: 16 });
    const view = new DataView(header.buffer);
    expect(view.getUint32(24, true)).toBe(44100);
  });

  it('writes correct byte rate = sampleRate * channels * bitDepth / 8', () => {
    const header = createWavHeader({ sampleRate: 48000, numberOfChannels: 2, bitDepth: 16 });
    const view = new DataView(header.buffer);
    // 48000 * 2 * 16 / 8 = 192000
    expect(view.getUint32(28, true)).toBe(192000);
  });

  it('writes correct block align = channels * bitDepth / 8', () => {
    const header = createWavHeader({ sampleRate: 48000, numberOfChannels: 2, bitDepth: 16 });
    const view = new DataView(header.buffer);
    // 2 * 16 / 8 = 4
    expect(view.getUint16(32, true)).toBe(4);
  });

  it('writes correct bits per sample', () => {
    const header = createWavHeader({ sampleRate: 48000, numberOfChannels: 2, bitDepth: 24 });
    const view = new DataView(header.buffer);
    expect(view.getUint16(34, true)).toBe(24);
  });

  it('uses large default totalDataLength when not specified', () => {
    const header = createWavHeader({ sampleRate: 48000, numberOfChannels: 2, bitDepth: 16 });
    const view = new DataView(header.buffer);
    // RIFF chunk length = 36 + 0x7fffffff
    expect(view.getUint32(4, true)).toBe(36 + 0x7fffffff);
    // data chunk length = 0x7fffffff
    expect(view.getUint32(40, true)).toBe(0x7fffffff);
  });

  it('uses provided totalDataLength', () => {
    const header = createWavHeader({
      sampleRate: 48000,
      numberOfChannels: 2,
      bitDepth: 16,
      totalDataLength: 1000,
    });
    const view = new DataView(header.buffer);
    expect(view.getUint32(4, true)).toBe(36 + 1000);
    expect(view.getUint32(40, true)).toBe(1000);
  });
});

describe('floatTo16BitPcm', () => {
  it('converts 0.0 to 0', () => {
    const result = floatTo16BitPcm(new Float32Array([0.0]));
    expect(result[0]).toBe(0);
  });

  it('converts 1.0 to 0x7fff (32767)', () => {
    const result = floatTo16BitPcm(new Float32Array([1.0]));
    expect(result[0]).toBe(0x7fff);
  });

  it('converts -1.0 to -0x8000 (-32768)', () => {
    const result = floatTo16BitPcm(new Float32Array([-1.0]));
    expect(result[0]).toBe(-0x8000);
  });

  it('clamps values above 1.0 to max', () => {
    const result = floatTo16BitPcm(new Float32Array([2.0]));
    expect(result[0]).toBe(0x7fff);
  });

  it('clamps values below -1.0 to min', () => {
    const result = floatTo16BitPcm(new Float32Array([-2.0]));
    expect(result[0]).toBe(-0x8000);
  });

  it('converts 0.5 to approximately 16383', () => {
    const result = floatTo16BitPcm(new Float32Array([0.5]));
    // 0.5 * 0x7fff = 16383.5 → truncated to 16383
    expect(result[0]).toBe(16383);
  });

  it('converts -0.5 to approximately -16384', () => {
    const result = floatTo16BitPcm(new Float32Array([-0.5]));
    // -0.5 * 0x8000 = -16384
    expect(result[0]).toBe(-16384);
  });

  it('handles empty input', () => {
    const result = floatTo16BitPcm(new Float32Array(0));
    expect(result.length).toBe(0);
  });

  it('converts a multi-sample buffer', () => {
    const input = new Float32Array([0.0, 0.25, -0.25, 1.0, -1.0]);
    const result = floatTo16BitPcm(input);
    expect(result.length).toBe(5);
    expect(result[0]).toBe(0);
    expect(result[3]).toBe(0x7fff);
    expect(result[4]).toBe(-0x8000);
  });
});
