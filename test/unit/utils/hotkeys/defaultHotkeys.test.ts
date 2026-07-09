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

  it('has navigateForward with Shift+Backspace', () => {
    expect(DEFAULT_HOTKEYS.bindings['general.navigateForward']).toBeDefined();
    expect(DEFAULT_HOTKEYS.bindings['general.navigateForward']).toContain('Shift+Backspace');
  });

  it('has navigateBack with Backspace and z', () => {
    expect(DEFAULT_HOTKEYS.bindings['general.navigateBack']).toBeDefined();
    expect(DEFAULT_HOTKEYS.bindings['general.navigateBack']).toContain('Backspace');
    expect(DEFAULT_HOTKEYS.bindings['general.navigateBack']).toContain('z');
  });

  it('has jumpPrevBoundary with A and ArrowUp', () => {
    expect(DEFAULT_HOTKEYS.bindings['playback.jumpPrevBoundary']).toBeDefined();
    expect(DEFAULT_HOTKEYS.bindings['playback.jumpPrevBoundary']).toContain('A');
    expect(DEFAULT_HOTKEYS.bindings['playback.jumpPrevBoundary']).toContain('ArrowUp');
  });

  it('has jumpNextBoundary with S and ArrowDown', () => {
    expect(DEFAULT_HOTKEYS.bindings['playback.jumpNextBoundary']).toBeDefined();
    expect(DEFAULT_HOTKEYS.bindings['playback.jumpNextBoundary']).toContain('S');
    expect(DEFAULT_HOTKEYS.bindings['playback.jumpNextBoundary']).toContain('ArrowDown');
  });

  it('has jumpPrevBoundaryTrack with Shift+A and Shift+ArrowUp', () => {
    expect(DEFAULT_HOTKEYS.bindings['playback.jumpPrevBoundaryTrack']).toBeDefined();
    expect(DEFAULT_HOTKEYS.bindings['playback.jumpPrevBoundaryTrack']).toContain('Shift+A');
    expect(DEFAULT_HOTKEYS.bindings['playback.jumpPrevBoundaryTrack']).toContain('Shift+ArrowUp');
  });

  it('has jumpNextBoundaryTrack with Shift+S and Shift+ArrowDown', () => {
    expect(DEFAULT_HOTKEYS.bindings['playback.jumpNextBoundaryTrack']).toBeDefined();
    expect(DEFAULT_HOTKEYS.bindings['playback.jumpNextBoundaryTrack']).toContain('Shift+S');
    expect(DEFAULT_HOTKEYS.bindings['playback.jumpNextBoundaryTrack']).toContain('Shift+ArrowDown');
  });

  it('has updated defaults for timeline creation and monitor snapshot', () => {
    expect(DEFAULT_HOTKEYS.bindings['general.newTimeline']).toEqual(['Ctrl+N']);
    expect(DEFAULT_HOTKEYS.bindings['general.snapshot']).toEqual(['Ctrl+H']);
  });

  it('has updated defaults for timeline trim and selection actions', () => {
    expect(DEFAULT_HOTKEYS.bindings['timeline.selectClipsLeftOfPlayhead']).toEqual(['Shift+D']);
    expect(DEFAULT_HOTKEYS.bindings['timeline.selectClipsRightOfPlayhead']).toEqual(['Shift+F']);
    expect(DEFAULT_HOTKEYS.bindings['timeline.trimToPlayheadLeft']).toEqual(['C']);
    expect(DEFAULT_HOTKEYS.bindings['timeline.trimToPlayheadRight']).toEqual(['V']);
    expect(DEFAULT_HOTKEYS.bindings['timeline.rippleTrimLeft']).toEqual(['Shift+E']);
    expect(DEFAULT_HOTKEYS.bindings['timeline.rippleTrimRight']).toEqual(['Shift+R']);
  });

  it('has updated defaults for waveform and thumbnail toggles', () => {
    expect(DEFAULT_HOTKEYS.bindings['timeline.toggleWaveformMode']).toEqual([',']);
    expect(DEFAULT_HOTKEYS.bindings['timeline.toggleShowWaveform']).toEqual(['.']);
    expect(DEFAULT_HOTKEYS.bindings['timeline.toggleShowThumbnails']).toEqual(['Shift+X']);
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

  it('has volume bindings on Ctrl+ArrowUp/Ctrl+ArrowDown', () => {
    expect(DEFAULT_HOTKEYS.bindings['timeline.increaseSelectedClipsVolume']).toEqual([
      'Ctrl+ArrowUp',
    ]);
    expect(DEFAULT_HOTKEYS.bindings['timeline.decreaseSelectedClipsVolume']).toEqual([
      'Ctrl+ArrowDown',
    ]);
    expect(DEFAULT_HOTKEYS.bindings['timeline.increaseSelectedClipsVolumeLarge']).toEqual([
      'Ctrl+Shift+ArrowUp',
    ]);
    expect(DEFAULT_HOTKEYS.bindings['timeline.decreaseSelectedClipsVolumeLarge']).toEqual([
      'Ctrl+Shift+ArrowDown',
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

  it('has defaults for start/end timeline and playback shortcuts', () => {
    expect(DEFAULT_HOTKEYS.bindings['playback.toStart']).toEqual(['W']);
    expect(DEFAULT_HOTKEYS.bindings['playback.toEnd']).toEqual(['T']);
    expect(DEFAULT_HOTKEYS.bindings['timeline.globalToStart']).toEqual(['Home']);
    expect(DEFAULT_HOTKEYS.bindings['timeline.globalToEnd']).toEqual(['End']);
  });

  it('has defaults for timeline group and ungroup clips shortcuts', () => {
    expect(DEFAULT_HOTKEYS.bindings['timeline.groupClips']).toEqual(['Ctrl+G']);
    expect(DEFAULT_HOTKEYS.bindings['timeline.ungroupClips']).toEqual(['Ctrl+Shift+G']);
  });

  it('binds F/D to the speed-cycle shortcuts and frees them from 1.5x', () => {
    expect(DEFAULT_HOTKEYS.bindings['playback.speedUpForward']).toEqual(['F']);
    expect(DEFAULT_HOTKEYS.bindings['playback.speedDown']).toEqual(['D']);
    // F/D used to drive the fixed 1.5x speeds; they are now unbound by default.
    expect(DEFAULT_HOTKEYS.bindings['playback.forward1_5']).toEqual([]);
    expect(DEFAULT_HOTKEYS.bindings['playback.backward1_5']).toEqual([]);
  });

  it('registers the speed-cycle commands in the commands registry', () => {
    const ids = DEFAULT_HOTKEYS.commands.map((c) => c.id);
    expect(ids).toContain('playback.speedUpForward');
    expect(ids).toContain('playback.speedDown');
  });
});
