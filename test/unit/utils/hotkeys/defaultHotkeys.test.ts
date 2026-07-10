/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { DEFAULT_HOTKEYS } from '~/utils/hotkeys/defaultHotkeys';
import type { HotkeyCommandId } from '~/utils/hotkeys/defaultHotkeys';

const Modifier1 = 'Modifier1';
const Modifier2 = 'Modifier2';

describe('DEFAULT_HOTKEYS', () => {
  it('contains commands array', () => {
    expect(DEFAULT_HOTKEYS.commands.length).toBeGreaterThan(0);
  });

  it('contains bindings for many commands', () => {
    expect(Object.keys(DEFAULT_HOTKEYS.bindings).length).toBeGreaterThan(0);
  });

  it('has binding for general.copy', () => {
    expect(DEFAULT_HOTKEYS.bindings['general.copy']).toBeDefined();
    expect(DEFAULT_HOTKEYS.bindings['general.copy']).toContain(`${Modifier2}+C`);
  });

  it('binds bare Space to 1x playback and modifier1+Space to current-speed playback', () => {
    expect(DEFAULT_HOTKEYS.bindings['playback.toggle1']).toContain('Space');
    expect(DEFAULT_HOTKEYS.bindings['playback.toggle']).toContain(`${Modifier1}+Space`);
  });

  it('binds the shuttle commands to S / D / F by default', () => {
    expect(DEFAULT_HOTKEYS.bindings['playback.shuttleForward']).toEqual(['F']);
    expect(DEFAULT_HOTKEYS.bindings['playback.shuttleReverse']).toEqual(['S']);
    expect(DEFAULT_HOTKEYS.bindings['playback.shuttleStop']).toEqual(['D']);
  });

  it('has binding for timeline.splitAtPlayhead', () => {
    expect(DEFAULT_HOTKEYS.bindings['timeline.splitAtPlayhead']).toBeDefined();
    expect(DEFAULT_HOTKEYS.bindings['timeline.splitAtPlayhead']).toContain('T');
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

  it('has binding for general.mute as modifier2+Q', () => {
    expect(DEFAULT_HOTKEYS.bindings['general.mute']).toBeDefined();
    expect(DEFAULT_HOTKEYS.bindings['general.mute']).toContain(`${Modifier2}+Q`);
  });

  it('has binding for general.addMarker as M', () => {
    expect(DEFAULT_HOTKEYS.bindings['general.addMarker']).toBeDefined();
    expect(DEFAULT_HOTKEYS.bindings['general.addMarker']).toContain('M');
  });

  it('has binding for general.createFolder as modifier2+\\', () => {
    expect(DEFAULT_HOTKEYS.bindings['general.createFolder']).toBeDefined();
    expect(DEFAULT_HOTKEYS.bindings['general.createFolder']).toEqual([`${Modifier2}+\\`]);
  });

  it('has bindings for general.volumeUp including modifier1+=', () => {
    expect(DEFAULT_HOTKEYS.bindings['general.volumeUp']).toBeDefined();
    expect(DEFAULT_HOTKEYS.bindings['general.volumeUp']).toContain(`${Modifier1}+=`);
  });

  it('has bindings for general.volumeDown including modifier1+-', () => {
    expect(DEFAULT_HOTKEYS.bindings['general.volumeDown']).toBeDefined();
    expect(DEFAULT_HOTKEYS.bindings['general.volumeDown']).toContain(`${Modifier1}+-`);
  });

  it('has binding for timeline.centerPlayhead as modifier1+/', () => {
    expect(DEFAULT_HOTKEYS.bindings['timeline.centerPlayhead']).toBeDefined();
    expect(DEFAULT_HOTKEYS.bindings['timeline.centerPlayhead']).toContain(`${Modifier1}+/`);
  });

  it('has navigateForward without modifier1+Backspace', () => {
    expect(DEFAULT_HOTKEYS.bindings['general.navigateForward'] ?? []).not.toContain(
      `${Modifier1}+Backspace`,
    );
  });

  it('has navigateBack with z only', () => {
    expect(DEFAULT_HOTKEYS.bindings['general.navigateBack']).toBeDefined();
    expect(DEFAULT_HOTKEYS.bindings['general.navigateBack']).toContain('z');
    expect(DEFAULT_HOTKEYS.bindings['general.navigateBack']).not.toContain('Backspace');
  });

  it('has navigateUp with modifier2+ArrowUp and Backspace', () => {
    expect(DEFAULT_HOTKEYS.bindings['general.navigateUp']).toBeDefined();
    expect(DEFAULT_HOTKEYS.bindings['general.navigateUp']).toContain(`${Modifier2}+ArrowUp`);
    expect(DEFAULT_HOTKEYS.bindings['general.navigateUp']).toContain('Backspace');
  });

  it('has jumpPrevBoundary with A and ArrowUp', () => {
    expect(DEFAULT_HOTKEYS.bindings['playback.jumpPrevBoundary']).toBeDefined();
    expect(DEFAULT_HOTKEYS.bindings['playback.jumpPrevBoundary']).toContain('A');
    expect(DEFAULT_HOTKEYS.bindings['playback.jumpPrevBoundary']).toContain('ArrowUp');
  });

  it('has jumpNextBoundary with G and ArrowDown', () => {
    expect(DEFAULT_HOTKEYS.bindings['playback.jumpNextBoundary']).toBeDefined();
    expect(DEFAULT_HOTKEYS.bindings['playback.jumpNextBoundary']).toContain('G');
    expect(DEFAULT_HOTKEYS.bindings['playback.jumpNextBoundary']).toContain('ArrowDown');
  });

  it('has jumpPrevBoundaryTrack with modifier1+A and modifier1+ArrowUp', () => {
    expect(DEFAULT_HOTKEYS.bindings['playback.jumpPrevBoundaryTrack']).toBeDefined();
    expect(DEFAULT_HOTKEYS.bindings['playback.jumpPrevBoundaryTrack']).toContain(`${Modifier1}+A`);
    expect(DEFAULT_HOTKEYS.bindings['playback.jumpPrevBoundaryTrack']).toContain(
      `${Modifier1}+ArrowUp`,
    );
  });

  it('has jumpNextBoundaryTrack with modifier1+G and modifier1+ArrowDown', () => {
    expect(DEFAULT_HOTKEYS.bindings['playback.jumpNextBoundaryTrack']).toBeDefined();
    expect(DEFAULT_HOTKEYS.bindings['playback.jumpNextBoundaryTrack']).toContain(`${Modifier1}+G`);
    expect(DEFAULT_HOTKEYS.bindings['playback.jumpNextBoundaryTrack']).toContain(
      `${Modifier1}+ArrowDown`,
    );
  });

  it('has updated defaults for timeline creation and monitor snapshot', () => {
    expect(DEFAULT_HOTKEYS.bindings['general.newTimeline']).toEqual([`${Modifier1}+N`]);
    expect(DEFAULT_HOTKEYS.bindings['general.snapshot']).toEqual([`${Modifier2}+H`]);
    expect(DEFAULT_HOTKEYS.bindings['monitor.center']).toEqual([]);
  });

  it('has updated defaults for timeline trim and selection actions', () => {
    expect(DEFAULT_HOTKEYS.bindings['timeline.selectClipsLeftOfPlayhead']).toEqual([
      `${Modifier1}+D`,
    ]);
    expect(DEFAULT_HOTKEYS.bindings['timeline.selectClipsRightOfPlayhead']).toEqual([
      `${Modifier1}+F`,
    ]);
    expect(DEFAULT_HOTKEYS.bindings['timeline.trimToPlayheadLeft']).toEqual(['C']);
    expect(DEFAULT_HOTKEYS.bindings['timeline.trimToPlayheadRight']).toEqual(['V']);
    expect(DEFAULT_HOTKEYS.bindings['timeline.rippleTrimLeft']).toEqual([`${Modifier1}+E`]);
    expect(DEFAULT_HOTKEYS.bindings['timeline.rippleTrimRight']).toEqual([`${Modifier1}+R`]);
  });

  it('has updated defaults for waveform and thumbnail toggles', () => {
    expect(DEFAULT_HOTKEYS.bindings['timeline.toggleWaveformMode']).toEqual([',']);
    expect(DEFAULT_HOTKEYS.bindings['timeline.toggleShowWaveform']).toEqual(['.']);
    expect(DEFAULT_HOTKEYS.bindings['timeline.toggleShowThumbnails']).toEqual([`${Modifier1}+X`]);
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
    expect(DEFAULT_HOTKEYS.bindings['timeline.toggleLockClip']).toEqual(['B']);
    expect(DEFAULT_HOTKEYS.bindings['timeline.toggleLockTrack']).toEqual([]);
  });

  it('has nudge clip bindings with modifier2 to avoid conflict with playhead stepping', () => {
    expect(DEFAULT_HOTKEYS.bindings['timeline.moveSelectedClipsLeft']).toEqual([
      `${Modifier2}+ArrowLeft`,
    ]);
    expect(DEFAULT_HOTKEYS.bindings['timeline.moveSelectedClipsRight']).toEqual([
      `${Modifier2}+ArrowRight`,
    ]);
    expect(DEFAULT_HOTKEYS.bindings['timeline.moveSelectedClipsLeftLarge']).toEqual([
      `${Modifier2}+${Modifier1}+ArrowLeft`,
    ]);
    expect(DEFAULT_HOTKEYS.bindings['timeline.moveSelectedClipsRightLarge']).toEqual([
      `${Modifier2}+${Modifier1}+ArrowRight`,
    ]);
  });

  it('has volume bindings on modifier2+ArrowUp/modifier2+ArrowDown', () => {
    expect(DEFAULT_HOTKEYS.bindings['timeline.increaseSelectedClipsVolume']).toEqual([
      `${Modifier2}+ArrowUp`,
    ]);
    expect(DEFAULT_HOTKEYS.bindings['timeline.decreaseSelectedClipsVolume']).toEqual([
      `${Modifier2}+ArrowDown`,
    ]);
    expect(DEFAULT_HOTKEYS.bindings['timeline.increaseSelectedClipsVolumeLarge']).toEqual([
      `${Modifier2}+${Modifier1}+ArrowUp`,
    ]);
    expect(DEFAULT_HOTKEYS.bindings['timeline.decreaseSelectedClipsVolumeLarge']).toEqual([
      `${Modifier2}+${Modifier1}+ArrowDown`,
    ]);
  });

  it('has defaults for project panel, settings and background task shortcuts', () => {
    expect(DEFAULT_HOTKEYS.bindings['general.projectTabFiles']).toEqual([`${Modifier1}+H`]);
    expect(DEFAULT_HOTKEYS.bindings['general.projectTabHistory']).toEqual([`${Modifier1}+J`]);
    expect(DEFAULT_HOTKEYS.bindings['general.projectTabEffects']).toEqual([`${Modifier1}+K`]);
    expect(DEFAULT_HOTKEYS.bindings['general.projectTabLibrary']).toEqual([`${Modifier1}+L`]);
    expect(DEFAULT_HOTKEYS.bindings['general.projectTabMarkers']).toEqual([`${Modifier1}+;`]);
    expect(DEFAULT_HOTKEYS.bindings['general.projectTabBackups']).toEqual([`${Modifier1}+'`]);
    expect(DEFAULT_HOTKEYS.bindings['general.backgroundTasks']).toEqual([`${Modifier1}+Y`]);
    expect(DEFAULT_HOTKEYS.bindings['general.projectSettings']).toEqual([`${Modifier1}+U`]);
    expect(DEFAULT_HOTKEYS.bindings['general.appSettings']).toEqual([`${Modifier1}+I`]);
  });

  it('has defaults for start/end timeline shortcuts', () => {
    expect(DEFAULT_HOTKEYS.bindings['timeline.globalToStart']).toEqual(['Home', `${Modifier2}+E`]);
    expect(DEFAULT_HOTKEYS.bindings['timeline.globalToEnd']).toEqual(['End', `${Modifier2}+R`]);
  });

  it('removed local monitor toStart/toEnd in favor of global timeline commands', () => {
    const ids = DEFAULT_HOTKEYS.commands.map((c) => c.id);
    expect(ids).not.toContain('playback.toStart');
    expect(ids).not.toContain('playback.toEnd');
    expect(DEFAULT_HOTKEYS.bindings['playback.toStart']).toBeUndefined();
    expect(DEFAULT_HOTKEYS.bindings['playback.toEnd']).toBeUndefined();
  });

  it('moves stepping and speed-cycle commands to the timeline & monitor global group', () => {
    const moved: HotkeyCommandId[] = [
      'playback.stepForward',
      'playback.stepBackward',
      'playback.stepForwardLarge',
      'playback.stepBackwardLarge',
      'playback.play1ResetSpeed',
      'playback.speedUpForward',
      'playback.speedDown',
    ];
    for (const id of moved) {
      const command = DEFAULT_HOTKEYS.commands.find((c) => c.id === id);
      expect(command, `expected ${id} to be registered`).toBeDefined();
      expect(command?.groupId).toBe('timelineMonitorGlobal');
    }
  });

  it('has defaults for timeline group and ungroup clips shortcuts', () => {
    expect(DEFAULT_HOTKEYS.bindings['timeline.groupClips']).toEqual([`${Modifier2}+G`]);
    expect(DEFAULT_HOTKEYS.bindings['timeline.ungroupClips']).toEqual([
      `${Modifier2}+${Modifier1}+G`,
    ]);
  });

  it('leaves speed-cycle and 1.5x commands unbound by default', () => {
    expect(DEFAULT_HOTKEYS.bindings['playback.speedUpForward']).toEqual([]);
    expect(DEFAULT_HOTKEYS.bindings['playback.speedDown']).toEqual([]);
    expect(DEFAULT_HOTKEYS.bindings['playback.play1ResetSpeed']).toEqual([]);
    expect(DEFAULT_HOTKEYS.bindings['playback.forward1_5']).toEqual([]);
    expect(DEFAULT_HOTKEYS.bindings['playback.backward1_5']).toEqual([]);
  });

  it('moves split, solo and boundary defaults to the new layout', () => {
    expect(DEFAULT_HOTKEYS.bindings['timeline.splitAtPlayhead']).toEqual(['T']);
    expect(DEFAULT_HOTKEYS.bindings['timeline.splitAllAtPlayhead']).toEqual([`${Modifier1}+T`]);
    expect(DEFAULT_HOTKEYS.bindings['timeline.toggleSoloTrack']).toEqual([`${Modifier1}+S`]);
    expect(DEFAULT_HOTKEYS.bindings['playback.jumpNextBoundary']).toEqual(['G', 'ArrowDown']);
    expect(DEFAULT_HOTKEYS.bindings['playback.jumpNextBoundaryTrack']).toEqual([
      `${Modifier1}+G`,
      `${Modifier1}+ArrowDown`,
    ]);
  });

  it('registers the speed-cycle commands in the commands registry', () => {
    const ids = DEFAULT_HOTKEYS.commands.map((c) => c.id);
    expect(ids).toContain('playback.speedUpForward');
    expect(ids).toContain('playback.speedDown');
  });
});
