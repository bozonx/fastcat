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
    expect(DEFAULT_HOTKEYS.bindings['general.copy']).toContain('Ctrl+C');
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

  it('has binding for general.mute as Ctrl+Q', () => {
    expect(DEFAULT_HOTKEYS.bindings['general.mute']).toBeDefined();
    expect(DEFAULT_HOTKEYS.bindings['general.mute']).toContain('Ctrl+Q');
  });

  it('has binding for general.addMarker as M', () => {
    expect(DEFAULT_HOTKEYS.bindings['general.addMarker']).toBeDefined();
    expect(DEFAULT_HOTKEYS.bindings['general.addMarker']).toContain('M');
  });

  it('has binding for general.createFolder as Ctrl+\\', () => {
    expect(DEFAULT_HOTKEYS.bindings['general.createFolder']).toBeDefined();
    expect(DEFAULT_HOTKEYS.bindings['general.createFolder']).toEqual(['Ctrl+\\']);
  });

  it('has bindings for general.volumeUp including Ctrl+R', () => {
    expect(DEFAULT_HOTKEYS.bindings['general.volumeUp']).toBeDefined();
    expect(DEFAULT_HOTKEYS.bindings['general.volumeUp']).toContain('Ctrl+R');
  });

  it('has bindings for general.volumeDown including Ctrl+E', () => {
    expect(DEFAULT_HOTKEYS.bindings['general.volumeDown']).toBeDefined();
    expect(DEFAULT_HOTKEYS.bindings['general.volumeDown']).toContain('Ctrl+E');
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

  it('has updated defaults for timeline creation and monitor snapshot', () => {
    expect(DEFAULT_HOTKEYS.bindings['general.newTimeline']).toEqual(['Ctrl+N']);
    expect(DEFAULT_HOTKEYS.bindings['general.snapshot']).toEqual(['Ctrl+H']);
  });

  it('has updated defaults for timeline trim and selection actions', () => {
    expect(DEFAULT_HOTKEYS.bindings['timeline.selectClipsLeftOfPlayhead']).toEqual(['E']);
    expect(DEFAULT_HOTKEYS.bindings['timeline.selectClipsRightOfPlayhead']).toEqual(['R']);
    expect(DEFAULT_HOTKEYS.bindings['timeline.rippleTrimLeft']).toEqual(['Shift+D']);
    expect(DEFAULT_HOTKEYS.bindings['timeline.rippleTrimRight']).toEqual(['Shift+F']);
    expect(DEFAULT_HOTKEYS.bindings['timeline.toggleShowWaveform']).toEqual(['Shift+E']);
    expect(DEFAULT_HOTKEYS.bindings['timeline.toggleShowThumbnails']).toEqual(['Shift+R']);
  });

  it('has defaults for timeline creation and mode shortcuts', () => {
    expect(DEFAULT_HOTKEYS.bindings['timeline.addTextClipAtPlayhead']).toEqual(['N']);
    expect(DEFAULT_HOTKEYS.bindings['timeline.addBackgroundClipAtPlayhead']).toEqual(['U']);
    expect(DEFAULT_HOTKEYS.bindings['timeline.addAdjustmentClipAtPlayhead']).toEqual(['Y']);
    expect(DEFAULT_HOTKEYS.bindings['timeline.selectSnapModeSnap']).toEqual(['H']);
    expect(DEFAULT_HOTKEYS.bindings['timeline.selectSnapModeNoSnap']).toEqual(['J']);
    expect(DEFAULT_HOTKEYS.bindings['timeline.selectSnapModeFree']).toEqual(['K']);
    expect(DEFAULT_HOTKEYS.bindings['timeline.selectDragModeMove']).toEqual(['L']);
    expect(DEFAULT_HOTKEYS.bindings['timeline.selectDragModePseudoOverlap']).toEqual([';']);
    expect(DEFAULT_HOTKEYS.bindings['timeline.selectDragModeSlip']).toEqual(["'"]);
  });

  it('has updated defaults for lock shortcuts', () => {
    expect(DEFAULT_HOTKEYS.bindings['timeline.toggleLockClip']).toEqual(['T']);
    expect(DEFAULT_HOTKEYS.bindings['timeline.toggleLockTrack']).toEqual(['Shift+T']);
  });

  it('has nudge clip bindings with Ctrl modifier to avoid conflict with playhead stepping', () => {
    expect(DEFAULT_HOTKEYS.bindings['timeline.moveSelectedClipsLeft']).toEqual(['Ctrl+ArrowLeft']);
    expect(DEFAULT_HOTKEYS.bindings['timeline.moveSelectedClipsRight']).toEqual([
      'Ctrl+ArrowRight',
    ]);
    expect(DEFAULT_HOTKEYS.bindings['timeline.moveSelectedClipsLeftLarge']).toEqual([
      'Ctrl+Shift+ArrowLeft',
    ]);
    expect(DEFAULT_HOTKEYS.bindings['timeline.moveSelectedClipsRightLarge']).toEqual([
      'Ctrl+Shift+ArrowRight',
    ]);
  });

  it('has defaults for project panel, settings and background task shortcuts', () => {
    expect(DEFAULT_HOTKEYS.bindings['general.projectTabFiles']).toEqual(['Shift+H']);
    expect(DEFAULT_HOTKEYS.bindings['general.projectTabHistory']).toEqual(['Shift+J']);
    expect(DEFAULT_HOTKEYS.bindings['general.projectTabEffects']).toEqual(['Shift+K']);
    expect(DEFAULT_HOTKEYS.bindings['general.projectTabLibrary']).toEqual(['Shift+L']);
    expect(DEFAULT_HOTKEYS.bindings['general.projectTabMarkers']).toEqual(['Shift+;']);
    expect(DEFAULT_HOTKEYS.bindings['general.projectTabBackups']).toEqual(["Shift+'"]);
    expect(DEFAULT_HOTKEYS.bindings['general.backgroundTasks']).toEqual(['Shift+Y']);
    expect(DEFAULT_HOTKEYS.bindings['general.projectSettings']).toEqual(['Shift+U']);
    expect(DEFAULT_HOTKEYS.bindings['general.appSettings']).toEqual(['Shift+I']);
  });
});
