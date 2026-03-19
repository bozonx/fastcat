import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mountWithNuxt } from '../utils/mount';
import EffectSettingsModal from '../../src/components/common/EffectSettingsModal.vue';
import { parametricEqManifest } from '../../src/effects/audio/parametric-eq/manifest';
import type { EffectManifest } from '../../src/effects/core/registry';
import { createDefaultProjectPresets, createDefaultExportPresets } from '../../src/utils/settings';

vi.mock('../../src/stores/timeline.store', () => ({
  useTimelineStore: vi.fn(() => ({
    timelineZoom: 50,
  })),
}));

vi.mock('../../src/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(() => ({
    userSettings: {
      projectDefaults: { audioDeclickDurationUs: 5000, defaultAudioFadeCurve: 'logarithmic' },
      projectPresets: createDefaultProjectPresets(),
      exportPresets: createDefaultExportPresets(),
      optimization: { proxyConcurrency: 2 },
      timeline: { defaultStaticClipDurationUs: 5000000, snapThresholdPx: 8 },
    },
  })),
}));

describe('EffectSettingsModal', () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const testManifest: EffectManifest = {
    type: 'audio-test-effect',
    name: 'Test Effect',
    description: 'Test effect description',
    icon: 'i-heroicons-beaker',
    target: 'audio',
    defaultValues: {},
    controls: [],
    settingsControls: [],
  };

  beforeEach(() => {
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof requestAnimationFrame;

    globalThis.cancelAnimationFrame = vi.fn();

    HTMLCanvasElement.prototype.getContext = vi.fn(() => {
      return {
        clearRect: vi.fn(),
        fillRect: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
      } as unknown as CanvasRenderingContext2D;
    }) as unknown as HTMLCanvasElement['getContext'];
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    document.body.innerHTML = '';
  });

  it('renders parametric eq visualization above settings', async () => {
    await mountWithNuxt(EffectSettingsModal, {
      props: {
        modelValue: true,
        manifest: parametricEqManifest,
        effect: structuredClone(parametricEqManifest.defaultValues),
      },
    });

    expect(
      document.body.querySelector('[data-testid="parametric-eq-visualization"]'),
    ).not.toBeNull();
    expect(document.body.querySelector('canvas')).not.toBeNull();
  });

  it('does not render parametric eq visualization for non-eq effects', async () => {
    await mountWithNuxt(EffectSettingsModal, {
      props: {
        modelValue: true,
        manifest: testManifest,
        effect: {},
      },
    });

    expect(document.body.querySelector('[data-testid="parametric-eq-visualization"]')).toBeNull();
  });
});
