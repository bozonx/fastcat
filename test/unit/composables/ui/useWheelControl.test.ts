/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { useWheelControl } from '~/composables/ui/useWheelControl';
import { useWheelSupport } from '~/composables/useWheelSupport';

vi.mock('~/composables/useWheelSupport', () => ({
  useWheelSupport: vi.fn(),
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => ({
    userSettings: { os: 'linux' },
  }),
}));

vi.mock('~/utils/hotkeys/layerUtils', () => ({
  isLayer1Active: vi.fn(() => false),
}));

describe('useWheelControl', () => {
  it('returns wrapperRef', () => {
    const onWheelStep = vi.fn();
    const { wrapperRef } = useWheelControl(
      { step: () => 1 },
      onWheelStep,
    );
    expect(wrapperRef).toBeDefined();
    expect(wrapperRef.value).toBeNull();
  });

  it('passes options to useWheelSupport', () => {
    vi.mocked(useWheelSupport).mockClear();
    const onWheelStep = vi.fn();
    useWheelControl(
      {
        step: () => 0.1,
        disabled: () => true,
        wheelStepMultiplier: () => 5,
        focusOnly: () => true,
      },
      onWheelStep,
    );
    expect(useWheelSupport).toHaveBeenCalledWith(
      expect.objectContaining({
        disabled: expect.any(Function),
        step: expect.any(Function),
        wheelStepMultiplier: expect.any(Function),
        focusOnly: true,
        onWheelStep,
      }),
    );
  });

  it('defaults focusOnly to false when not provided', () => {
    vi.mocked(useWheelSupport).mockClear();
    useWheelControl({ step: () => 1 }, vi.fn());
    expect(useWheelSupport).toHaveBeenCalledWith(
      expect.objectContaining({
        focusOnly: false,
      }),
    );
  });
});
