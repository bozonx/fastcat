export type HotkeyGroupId = 'general' | 'fileManager' | 'playback' | 'timeline';

export type HotkeyCommandId =
  | 'general.focus'
  | 'general.deselect'
  | 'general.copy'
  | 'general.cut'
  | 'general.paste'
  | 'general.delete'
  | 'general.rename'
  | 'general.save'
  | 'general.undo'
  | 'general.redo'
  | 'general.mute'
  | 'general.addMarker'
  | 'general.prevMarker'
  | 'general.nextMarker'
  | 'general.volumeUp'
  | 'general.volumeDown'
  | 'general.fullscreen'
  | 'general.zoomIn'
  | 'general.zoomOut'
  | 'general.zoomReset'
  | 'general.zoomFit'
  | 'general.tab1'
  | 'general.tab2'
  | 'general.tab3'
  | 'general.tab4'
  | 'general.tab5'
  | 'general.tab6'
  | 'general.tab7'
  | 'general.tab8'
  | 'general.tab9'
  | 'general.switchViewFiles'
  | 'general.switchViewCut'
  | 'general.switchViewEffects'
  | 'general.switchViewSound'
  | 'general.switchViewExport'
  | 'general.selectAll'
  | 'general.snapshot'
  | 'general.newTimeline'
  | 'timeline.duplicate'
  | 'timeline.toggleSnap'
  | 'timeline.toggleSnapFree'
  | 'timeline.selectClipsLeftOfPlayhead'
  | 'timeline.selectClipsRightOfPlayhead'
  | 'timeline.trimToPlayheadLeft'
  | 'timeline.trimToPlayheadRight'
  | 'timeline.rippleTrimLeft'
  | 'timeline.rippleTrimRight'
  | 'timeline.advancedRippleTrimLeft'
  | 'timeline.advancedRippleTrimRight'
  | 'timeline.rippleDeleteSelectedClipRange'
  | 'timeline.rippleDelete'
  | 'timeline.jumpPrevBoundary'
  | 'timeline.jumpNextBoundary'
  | 'timeline.jumpPrevBoundaryTrack'
  | 'timeline.jumpNextBoundaryTrack'
  | 'timeline.splitAtPlayhead'
  | 'timeline.splitAllAtPlayhead'
  | 'timeline.toggleDisableClip'
  | 'timeline.toggleMuteClip'
  | 'timeline.toggleVisibilityTrack'
  | 'timeline.toggleMuteTrack'
  | 'timeline.toggleSoloTrack'
  | 'timeline.moveSelectedClipsLeft'
  | 'timeline.moveSelectedClipsRight'
  | 'timeline.moveSelectedClipsLeftLarge'
  | 'timeline.moveSelectedClipsRightLarge'
  | 'timeline.increaseSelectedClipsVolume'
  | 'timeline.decreaseSelectedClipsVolume'
  | 'timeline.increaseSelectedClipsVolumeLarge'
  | 'timeline.decreaseSelectedClipsVolumeLarge'
  | 'timeline.copyClipParameters'
  | 'timeline.pasteClipParameters'
  | 'timeline.toggleWaveformMode'
  | 'timeline.toggleShowWaveform'
  | 'timeline.toggleShowThumbnails'
  | 'timeline.toggleFreezeFrame'
  | 'timeline.toggleLockClip'
  | 'timeline.toggleLockTrack'
  | 'timeline.setSelectionIn'
  | 'timeline.setSelectionOut'
  | 'timeline.centerPlayhead'
  | 'playback.toggle'
  | 'playback.toggle1'
  | 'playback.toStart'
  | 'playback.toEnd'
  | 'playback.stepForward'
  | 'playback.stepBackward'
  | 'playback.stepForwardLarge'
  | 'playback.stepBackwardLarge'
  | 'playback.forward1_25'
  | 'playback.backward1_25'
  | 'playback.forward1_5'
  | 'playback.backward1_5'
  | 'playback.forward1_75'
  | 'playback.backward1_75'
  | 'playback.forward2'
  | 'playback.backward2'
  | 'playback.forward3'
  | 'playback.backward3'
  | 'playback.forward5'
  | 'playback.backward5'
  | 'playback.forward0_75'
  | 'playback.backward0_75'
  | 'playback.forward0_5'
  | 'playback.backward0_5'
  | 'playback.backward1'
  | 'general.navigateBack'
  | 'general.navigateForward'
  | 'general.navigateUp';
  // Note: ArrowUp, ArrowDown, ArrowLeft, and ArrowRight keys for list selection
  // are handled locally inside the file browser components and are intentionally
  // excluded from global customizable hotkeys to avoid breaking standard inputs/dropdowns.

export type HotkeyCombo = string;

const Mod = 'Control'; // Placeholder for actual mod detection logic if used here, or handled by a composable

export interface HotkeyCommand {
  id: HotkeyCommandId;
  groupId: HotkeyGroupId;
  title: string;
}

export interface HotkeyCommandDefinition {
  id: HotkeyCommandId;
  groupId: HotkeyGroupId;
  title: string;
  description?: string;
}

export interface HotkeyRegistry {
  commands: HotkeyCommand[];
  bindings: Partial<Record<HotkeyCommandId, HotkeyCombo[]>>;
}

export const DEFAULT_HOTKEYS: HotkeyRegistry = {
  commands: [
    { id: 'general.copy', groupId: 'general', title: 'Copy' },
    { id: 'general.cut', groupId: 'general', title: 'Cut' },
    { id: 'general.paste', groupId: 'general', title: 'Paste' },
    { id: 'general.undo', groupId: 'general', title: 'Undo' },
    { id: 'general.redo', groupId: 'general', title: 'Redo' },
    { id: 'general.delete', groupId: 'general', title: 'Delete' },
    { id: 'general.selectAll', groupId: 'general', title: 'Select all' },
    { id: 'general.deselect', groupId: 'general', title: 'Deselect all / Close modals' },
    { id: 'general.save', groupId: 'general', title: 'Save' },
    { id: 'general.focus', groupId: 'general', title: 'Focus / Search' },
    { id: 'general.rename', groupId: 'general', title: 'Rename' },
    { id: 'general.newTimeline', groupId: 'general', title: 'Create new timeline' },
    { id: 'general.mute', groupId: 'general', title: 'Mute / Unmute' },
    { id: 'general.volumeUp', groupId: 'general', title: 'Increase monitor volume' },
    { id: 'general.volumeDown', groupId: 'general', title: 'Decrease monitor volume' },
    { id: 'general.snapshot', groupId: 'general', title: 'Create snapshot from monitor' },
    { id: 'general.fullscreen', groupId: 'general', title: 'Toggle fullscreen' },
    { id: 'general.zoomIn', groupId: 'general', title: 'Zoom in' },
    { id: 'general.zoomOut', groupId: 'general', title: 'Zoom out' },
    { id: 'general.zoomReset', groupId: 'general', title: 'Reset zoom' },
    { id: 'general.zoomFit', groupId: 'general', title: 'Fit to window' },
    { id: 'general.addMarker', groupId: 'general', title: 'Add marker' },
    { id: 'general.prevMarker', groupId: 'general', title: 'Previous marker' },
    { id: 'general.nextMarker', groupId: 'general', title: 'Next marker' },
    { id: 'general.switchViewFiles', groupId: 'general', title: 'Switch to Files' },
    { id: 'general.switchViewCut', groupId: 'general', title: 'Switch to Cut' },
    { id: 'general.switchViewEffects', groupId: 'general', title: 'Switch to Effects' },
    { id: 'general.switchViewSound', groupId: 'general', title: 'Switch to Sound' },
    { id: 'general.switchViewExport', groupId: 'general', title: 'Switch to Export' },
    { id: 'general.tab1', groupId: 'general', title: 'Switch to tab 1' },
    { id: 'general.tab2', groupId: 'general', title: 'Switch to tab 2' },
    { id: 'general.tab3', groupId: 'general', title: 'Switch to tab 3' },
    { id: 'general.tab4', groupId: 'general', title: 'Switch to tab 4' },
    { id: 'general.tab5', groupId: 'general', title: 'Switch to tab 5' },
    { id: 'general.tab6', groupId: 'general', title: 'Switch to tab 6' },
    { id: 'general.tab7', groupId: 'general', title: 'Switch to tab 7' },
    { id: 'general.tab8', groupId: 'general', title: 'Switch to tab 8' },
    { id: 'general.tab9', groupId: 'general', title: 'Switch to tab 9' },
    { id: 'timeline.duplicate', groupId: 'timeline', title: 'Duplicate timeline / Create version' },
    { id: 'general.navigateBack', groupId: 'fileManager', title: 'Navigate back' },
    { id: 'general.navigateForward', groupId: 'fileManager', title: 'Navigate forward' },
    { id: 'general.navigateUp', groupId: 'fileManager', title: 'Navigate up' },

    { id: 'timeline.toggleSnap', groupId: 'timeline', title: 'Toggle snap' },
    { id: 'timeline.toggleSnapFree', groupId: 'timeline', title: 'Toggle snap free mode' },
    {
      id: 'timeline.selectClipsLeftOfPlayhead',
      groupId: 'timeline',
      title: 'Select clips left of playhead',
    },
    {
      id: 'timeline.selectClipsRightOfPlayhead',
      groupId: 'timeline',
      title: 'Select clips right of playhead',
    },
    {
      id: 'timeline.trimToPlayheadLeft',
      groupId: 'timeline',
      title: 'Trim clip start to playhead',
    },
    { id: 'timeline.trimToPlayheadRight', groupId: 'timeline', title: 'Trim clip end to playhead' },
    {
      id: 'timeline.rippleTrimLeft',
      groupId: 'timeline',
      title: 'Ripple trim clip start to playhead',
    },
    {
      id: 'timeline.rippleTrimRight',
      groupId: 'timeline',
      title: 'Ripple trim clip end to playhead',
    },
    {
      id: 'timeline.advancedRippleTrimLeft',
      groupId: 'timeline',
      title: 'Advanced ripple trim start',
    },
    {
      id: 'timeline.advancedRippleTrimRight',
      groupId: 'timeline',
      title: 'Advanced ripple trim end',
    },
    {
      id: 'timeline.rippleDeleteSelectedClipRange',
      groupId: 'timeline',
      title: 'Ripple delete selected clip range on all tracks',
    },
    { id: 'timeline.rippleDelete', groupId: 'timeline', title: 'Ripple delete' },
    { id: 'timeline.jumpPrevBoundary', groupId: 'timeline', title: 'Jump to previous edit point' },
    { id: 'timeline.jumpNextBoundary', groupId: 'timeline', title: 'Jump to next edit point' },
    {
      id: 'timeline.jumpPrevBoundaryTrack',
      groupId: 'timeline',
      title: 'Jump to previous edit point on track',
    },
    {
      id: 'timeline.jumpNextBoundaryTrack',
      groupId: 'timeline',
      title: 'Jump to next edit point on track',
    },
    { id: 'timeline.splitAtPlayhead', groupId: 'timeline', title: 'Split at playhead' },
    { id: 'timeline.splitAllAtPlayhead', groupId: 'timeline', title: 'Split all at playhead' },
    { id: 'timeline.toggleDisableClip', groupId: 'timeline', title: 'Disable / Enable clip' },
    { id: 'timeline.toggleMuteClip', groupId: 'timeline', title: 'Mute / Unmute clip' },
    {
      id: 'timeline.toggleVisibilityTrack',
      groupId: 'timeline',
      title: 'Hide / Show video track',
    },
    { id: 'timeline.toggleMuteTrack', groupId: 'timeline', title: 'Mute / Unmute audio track' },
    { id: 'timeline.toggleSoloTrack', groupId: 'timeline', title: 'Solo / Unsolo audio track' },
    {
      id: 'timeline.moveSelectedClipsLeft',
      groupId: 'timeline',
      title: 'Move selected clips left',
    },
    {
      id: 'timeline.moveSelectedClipsRight',
      groupId: 'timeline',
      title: 'Move selected clips right',
    },
    {
      id: 'timeline.moveSelectedClipsLeftLarge',
      groupId: 'timeline',
      title: 'Move selected clips left (large step)',
    },
    {
      id: 'timeline.moveSelectedClipsRightLarge',
      groupId: 'timeline',
      title: 'Move selected clips right (large step)',
    },
    {
      id: 'timeline.increaseSelectedClipsVolume',
      groupId: 'timeline',
      title: 'Increase selected clips volume',
    },
    {
      id: 'timeline.decreaseSelectedClipsVolume',
      groupId: 'timeline',
      title: 'Decrease selected clips volume',
    },
    {
      id: 'timeline.increaseSelectedClipsVolumeLarge',
      groupId: 'timeline',
      title: 'Increase selected clips volume (large step)',
    },
    {
      id: 'timeline.decreaseSelectedClipsVolumeLarge',
      groupId: 'timeline',
      title: 'Decrease selected clips volume (large step)',
    },
    {
      id: 'timeline.copyClipParameters',
      groupId: 'timeline',
      title: 'Copy clip parameters',
    },
    {
      id: 'timeline.pasteClipParameters',
      groupId: 'timeline',
      title: 'Paste clip parameters',
    },
    {
      id: 'timeline.toggleWaveformMode',
      groupId: 'timeline',
      title: 'Toggle clip waveform mode',
    },
    {
      id: 'timeline.toggleShowWaveform',
      groupId: 'timeline',
      title: 'Toggle show clip waveform',
    },
    {
      id: 'timeline.toggleShowThumbnails',
      groupId: 'timeline',
      title: 'Toggle show clip thumbnails',
    },
    {
      id: 'timeline.toggleFreezeFrame',
      groupId: 'timeline',
      title: 'Toggle clip freeze frame',
    },
    {
      id: 'timeline.toggleLockClip',
      groupId: 'timeline',
      title: 'Toggle lock clip',
    },
    {
      id: 'timeline.toggleLockTrack',
      groupId: 'timeline',
      title: 'Toggle lock track',
    },
    { id: 'timeline.setSelectionIn', groupId: 'timeline', title: 'Set selection In' },
    { id: 'timeline.setSelectionOut', groupId: 'timeline', title: 'Set selection Out' },
    { id: 'timeline.centerPlayhead', groupId: 'timeline', title: 'Center playhead' },

    { id: 'playback.toggle', groupId: 'playback', title: 'Toggle playback' },
    { id: 'playback.toggle1', groupId: 'playback', title: 'Toggle playback (secondary)' },
    { id: 'playback.toStart', groupId: 'playback', title: 'Go to start' },
    { id: 'playback.toEnd', groupId: 'playback', title: 'Go to end' },
    { id: 'playback.stepForward', groupId: 'playback', title: 'Step forward' },
    { id: 'playback.stepBackward', groupId: 'playback', title: 'Step backward' },
    { id: 'playback.stepForwardLarge', groupId: 'playback', title: 'Step forward (large)' },
    { id: 'playback.stepBackwardLarge', groupId: 'playback', title: 'Step backward (large)' },
    { id: 'playback.forward1_25', groupId: 'playback', title: 'Forward 1.25x' },
    { id: 'playback.backward1_25', groupId: 'playback', title: 'Backward 1.25x' },
    { id: 'playback.forward1_5', groupId: 'playback', title: 'Forward 1.5x' },
    { id: 'playback.backward1_5', groupId: 'playback', title: 'Backward 1.5x' },
    { id: 'playback.forward1_75', groupId: 'playback', title: 'Forward 1.75x' },
    { id: 'playback.backward1_75', groupId: 'playback', title: 'Backward 1.75x' },
    { id: 'playback.forward2', groupId: 'playback', title: 'Forward 2x' },
    { id: 'playback.backward2', groupId: 'playback', title: 'Backward 2x' },
    { id: 'playback.forward3', groupId: 'playback', title: 'Forward 3x' },
    { id: 'playback.backward3', groupId: 'playback', title: 'Backward 3x' },
    { id: 'playback.forward5', groupId: 'playback', title: 'Forward 5x' },
    { id: 'playback.backward5', groupId: 'playback', title: 'Backward 5x' },
    { id: 'playback.forward0_75', groupId: 'playback', title: 'Forward 0.75x' },
    { id: 'playback.backward0_75', groupId: 'playback', title: 'Backward 0.75x' },
    { id: 'playback.forward0_5', groupId: 'playback', title: 'Forward 0.5x' },
    { id: 'playback.backward0_5', groupId: 'playback', title: 'Backward 0.5x' },
    { id: 'playback.backward1', groupId: 'playback', title: 'Backward 1x' },
  ],
  bindings: {
    'general.copy': [`${Mod}+C`],
    'general.cut': [`${Mod}+X`],
    'general.paste': [`${Mod}+V`],
    'general.undo': [`${Mod}+Z`],
    'general.redo': [`${Mod}+Y`, `${Mod}+Shift+Z`],
    'general.delete': ['Delete', 'X'],
    'general.selectAll': [`${Mod}+A`],
    'general.deselect': ['Escape'],

    'general.focus': ['Tab'],
    'general.rename': ['F2'],
    'general.save': [`${Mod}+S`],
    'general.newTimeline': ['N', `${Mod}+N`],

    'general.mute': ['Control+Q'],
    'general.volumeUp': ['Control+R'],
    'general.volumeDown': ['Control+E'],
    'general.snapshot': ['H'],
    'general.fullscreen': ['`'],

    'general.zoomIn': ['='],
    'general.zoomOut': ['-'],
    'general.zoomReset': ['0'],
    'general.zoomFit': ['Shift+0'],

    'general.addMarker': ['M'],
    'general.prevMarker': ['['],
    'general.nextMarker': [']'],

    'general.switchViewFiles': ['1'],
    'general.switchViewCut': ['2'],
    'general.switchViewEffects': ['3'],
    'general.switchViewSound': ['4'],
    'general.switchViewExport': ['5'],

    'general.tab1': ['Shift+1'],
    'general.tab2': ['Shift+2'],
    'general.tab3': ['Shift+3'],
    'general.tab4': ['Shift+4'],
    'general.tab5': ['Shift+5'],
    'general.tab6': ['Shift+6'],
    'general.tab7': ['Shift+7'],
    'general.tab8': ['Shift+8'],
    'general.tab9': ['Shift+9'],

    'timeline.duplicate': [`${Mod}+Shift+S`],
    'general.navigateBack': ['Backspace', 'z', 'MouseBack'],
    'general.navigateForward': ['Shift+Backspace', 'MouseForward'],
    'general.navigateUp': [`${Mod}+ArrowUp`],

    'timeline.toggleSnap': ['T'],
    'timeline.toggleSnapFree': ['Shift+T'],
    'timeline.selectClipsLeftOfPlayhead': ['Shift+D'],
    'timeline.selectClipsRightOfPlayhead': ['Shift+F'],
    'timeline.trimToPlayheadLeft': ['C'],
    'timeline.trimToPlayheadRight': ['V'],
    'timeline.rippleTrimLeft': ['E'],
    'timeline.rippleTrimRight': ['R'],
    'timeline.advancedRippleTrimLeft': ['D'],
    'timeline.advancedRippleTrimRight': ['F'],
    'timeline.rippleDeleteSelectedClipRange': ['Z'],
    'timeline.rippleDelete': ['Shift+Z', 'Backspace'],
    'timeline.jumpPrevBoundary': ['A', 'MouseForward'],
    'timeline.jumpNextBoundary': ['S', 'MouseBack'],
    'timeline.jumpPrevBoundaryTrack': ['Shift+A'],
    'timeline.jumpNextBoundaryTrack': ['Shift+S'],
    'timeline.splitAtPlayhead': ['G'],
    'timeline.splitAllAtPlayhead': ['Shift+G'],
    'timeline.toggleDisableClip': ['W'],
    'timeline.toggleMuteClip': ['Q'],
    'timeline.toggleVisibilityTrack': ['Shift+W'],
    'timeline.toggleMuteTrack': ['Shift+Q'],
    'timeline.toggleSoloTrack': ['B'],
    'timeline.moveSelectedClipsLeft': ['ArrowLeft'],
    'timeline.moveSelectedClipsRight': ['ArrowRight'],
    'timeline.moveSelectedClipsLeftLarge': ['Shift+ArrowLeft'],
    'timeline.moveSelectedClipsRightLarge': ['Shift+ArrowRight'],
    'timeline.increaseSelectedClipsVolume': ['ArrowUp'],
    'timeline.decreaseSelectedClipsVolume': ['ArrowDown'],
    'timeline.increaseSelectedClipsVolumeLarge': ['Shift+ArrowUp'],
    'timeline.decreaseSelectedClipsVolumeLarge': ['Shift+ArrowDown'],
    'timeline.copyClipParameters': ['Shift+C'],
    'timeline.pasteClipParameters': ['Shift+V'],
    'timeline.toggleWaveformMode': ['Shift+X'],
    'timeline.toggleShowWaveform': ['Shift+E'],
    'timeline.toggleShowThumbnails': ['Shift+R'],
    'timeline.toggleFreezeFrame': ['Shift+B'],
    'timeline.toggleLockClip': ['Y'],
    'timeline.toggleLockTrack': ['Shift+Y'],
    'timeline.setSelectionIn': ['I'],
    'timeline.setSelectionOut': ['O'],
    'timeline.centerPlayhead': ['Shift+/'],

    'playback.toggle': ['Space'],
    'playback.toggle1': ['Shift+Space'],
    'playback.toStart': ['W', 'Home'],
    'playback.toEnd': ['T', 'End'],
    'playback.stepForward': ['ArrowRight'],
    'playback.stepBackward': ['ArrowLeft'],
    'playback.stepForwardLarge': ['Shift+ArrowRight'],
    'playback.stepBackwardLarge': ['Shift+ArrowLeft'],
    'playback.forward1_25': ['F'],
    'playback.backward1_25': ['D'],
    'playback.forward1_5': ['Shift+F'],
    'playback.backward1_5': ['Shift+D'],
    'playback.forward1_75': ['R'],
    'playback.backward1_75': ['E'],
    'playback.forward2': ['Shift+R'],
    'playback.backward2': ['Shift+E'],
    'playback.forward3': ['G'],
    'playback.backward3': ['S'],
    'playback.forward5': ['Shift+G'],
    'playback.backward5': ['Shift+S'],
    'playback.forward0_75': ['V'],
    'playback.backward0_75': ['C'],
    'playback.forward0_5': ['Shift+V'],
    'playback.backward0_5': ['Shift+C'],
    'playback.backward1': ['A'],
  },
};
