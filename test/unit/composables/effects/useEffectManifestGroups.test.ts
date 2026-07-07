import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useEffectManifestGroups } from '~/composables/effects/useEffectManifestGroups';
import { initEffects, registerEffect, unregisterEffect } from '~/effects';

const runtime = vi.hoisted(() => ({
  isTauri: false,
}));

vi.mock('~/utils/runtime', () => ({
  isTauriRuntime: () => runtime.isTauri,
}));

beforeAll(() => {
  initEffects();
});

beforeEach(() => {
  setActivePinia(createPinia());
  runtime.isTauri = false;
  unregisterEffect('clap:test-plugin');
});

describe('useEffectManifestGroups', () => {
  it('keeps the full built-in audio catalog on web', () => {
    const { groups } = useEffectManifestGroups('audio');
    const types = groups.value.standard.map((manifest) => manifest.type);

    expect(types).toContain('audio-compressor');
    expect(types).toContain('audio-reverb');
    expect(types).toContain('audio-echo');
  });

  it('shows only native-supported built-in audio effects in Tauri', () => {
    runtime.isTauri = true;

    const { groups } = useEffectManifestGroups('audio');
    const types = groups.value.standard.map((manifest) => manifest.type);

    expect(types).toEqual(
      expect.arrayContaining([
        'audio-echo',
        'audio-distortion',
        'audio-tremolo',
        'audio-env-behind-wall',
        'audio-env-muffled',
        'audio-telephone',
        'audio-voice-underwater',
      ]),
    );
    expect(types).not.toContain('audio-compressor');
    expect(types).not.toContain('audio-reverb');
    expect(types).not.toContain('audio-flanger');
  });

  it('keeps registered native plugin manifests visible in Tauri', () => {
    runtime.isTauri = true;
    registerEffect({
      type: 'clap:test-plugin',
      name: 'CLAP Test',
      description: 'Test plugin',
      icon: 'i-heroicons-puzzle-piece',
      target: 'audio',
      defaultValues: {
        wet: 1,
        plugin: { format: 'clap', path: '/tmp/test.clap', pluginId: 'test' },
      },
      controls: [],
    });

    const { groups } = useEffectManifestGroups('audio');
    const types = groups.value.standard.map((manifest) => manifest.type);

    expect(types).toContain('clap:test-plugin');
  });
});
