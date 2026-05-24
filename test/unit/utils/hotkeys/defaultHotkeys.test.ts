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

  it('has binding for timeline.rippleDeleteSelectedClipRange', () => {
    expect(DEFAULT_HOTKEYS.bindings['timeline.rippleDeleteSelectedClipRange']).toBeDefined();
    expect(DEFAULT_HOTKEYS.bindings['timeline.rippleDeleteSelectedClipRange']).toContain('Z');
  });

  it('has binding for general.delete including X', () => {
    expect(DEFAULT_HOTKEYS.bindings['general.delete']).toBeDefined();
    expect(DEFAULT_HOTKEYS.bindings['general.delete']).toContain('Delete');
    expect(DEFAULT_HOTKEYS.bindings['general.delete']).toContain('X');
  });

  it('has binding for general.mute as Control+Q', () => {
    expect(DEFAULT_HOTKEYS.bindings['general.mute']).toBeDefined();
    expect(DEFAULT_HOTKEYS.bindings['general.mute']).toContain('Control+Q');
  });

  it('has binding for general.addMarker as M', () => {
    expect(DEFAULT_HOTKEYS.bindings['general.addMarker']).toBeDefined();
    expect(DEFAULT_HOTKEYS.bindings['general.addMarker']).toContain('M');
  });

  it('has bindings for general.volumeUp including Control+R', () => {
    expect(DEFAULT_HOTKEYS.bindings['general.volumeUp']).toBeDefined();
    expect(DEFAULT_HOTKEYS.bindings['general.volumeUp']).toContain('Control+R');
  });

  it('has bindings for general.volumeDown including Control+E', () => {
    expect(DEFAULT_HOTKEYS.bindings['general.volumeDown']).toBeDefined();
    expect(DEFAULT_HOTKEYS.bindings['general.volumeDown']).toContain('Control+E');
  });

  it('has binding for timeline.centerPlayhead as Shift+/', () => {
    expect(DEFAULT_HOTKEYS.bindings['timeline.centerPlayhead']).toBeDefined();
    expect(DEFAULT_HOTKEYS.bindings['timeline.centerPlayhead']).toContain('Shift+/');
  });

  it('has navigateForward with Shift+Backspace and MouseForward', () => {
    expect(DEFAULT_HOTKEYS.bindings['general.navigateForward']).toBeDefined();
    expect(DEFAULT_HOTKEYS.bindings['general.navigateForward']).toContain('Shift+Backspace');
    expect(DEFAULT_HOTKEYS.bindings['general.navigateForward']).toContain('MouseForward');
  });

  it('has navigateBack with Backspace, z and MouseBack', () => {
    expect(DEFAULT_HOTKEYS.bindings['general.navigateBack']).toBeDefined();
    expect(DEFAULT_HOTKEYS.bindings['general.navigateBack']).toContain('Backspace');
    expect(DEFAULT_HOTKEYS.bindings['general.navigateBack']).toContain('z');
    expect(DEFAULT_HOTKEYS.bindings['general.navigateBack']).toContain('MouseBack');
  });

  it('has jumpPrevBoundary with A and MouseForward', () => {
    expect(DEFAULT_HOTKEYS.bindings['timeline.jumpPrevBoundary']).toBeDefined();
    expect(DEFAULT_HOTKEYS.bindings['timeline.jumpPrevBoundary']).toContain('A');
    expect(DEFAULT_HOTKEYS.bindings['timeline.jumpPrevBoundary']).toContain('MouseForward');
  });

  it('has jumpNextBoundary with S and MouseBack', () => {
    expect(DEFAULT_HOTKEYS.bindings['timeline.jumpNextBoundary']).toBeDefined();
    expect(DEFAULT_HOTKEYS.bindings['timeline.jumpNextBoundary']).toContain('S');
    expect(DEFAULT_HOTKEYS.bindings['timeline.jumpNextBoundary']).toContain('MouseBack');
  });
});
