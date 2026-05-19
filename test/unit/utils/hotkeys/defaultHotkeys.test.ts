/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { DEFAULT_HOTKEYS } from '~/utils/hotkeys/defaultHotkeys';

describe('DEFAULT_HOTKEYS', () => {
  it('contains commands array', () => {
    expect(DEFAULT_HOTKEYS.commands.length).toBeGreaterThan(0);
  });

  it('contains bindings for many commands', () => {
    expect(Object.keys(DEFAULT_HOTKEYS.bindings).length).toBeGreaterThan(0);
  });

  it('has binding for general.copy', () => {
    expect(DEFAULT_HOTKEYS.bindings['general.copy']).toBeDefined();
    expect(DEFAULT_HOTKEYS.bindings['general.copy']).toContain('Control+C');
  });

  it('has binding for playback.toggle', () => {
    expect(DEFAULT_HOTKEYS.bindings['playback.toggle']).toBeDefined();
    expect(DEFAULT_HOTKEYS.bindings['playback.toggle']).toContain('Space');
  });

  it('has binding for timeline.splitAtPlayhead', () => {
    expect(DEFAULT_HOTKEYS.bindings['timeline.splitAtPlayhead']).toBeDefined();
    expect(DEFAULT_HOTKEYS.bindings['timeline.splitAtPlayhead']).toContain('G');
  });
});
