export type HotkeyGroupId = 'general' | 'playback' | 'timeline';

export type HotkeyCommandId =
  | 'general.focus'
  | 'general.deselect'
  | 'general.copy'
  | 'general.cut'
  | 'general.paste'
  | 'general.delete'
  | 'general.rename'
  | 'general.undo'
  | 'general.redo'
  | 'general.mute'
  | 'general.addMarker'
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
  | 'general.switchViewSound'
  | 'general.switchViewExport'
  | 'general.selectAll'
  | 'general.snapshot'
  | 'general.newTimeline'
  | 'timeline.duplicate'
  | 'timeline.toggleSnap'
  | 'timeline.selectClipsLeftOfPlayhead'
  | 'timeline.selectClipsRightOfPlayhead'
  | 'timeline.trimToPlayheadLeft'
  | 'timeline.trimToPlayheadRight'
  | 'timeline.rippleTrimLeft'
  | 'timeline.rippleTrimRight'
  | 'timeline.advancedRippleTrimLeft'
  | 'timeline.advancedRippleTrimRight'
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
  | 'timeline.setSelectionIn'
  | 'timeline.setSelectionOut'
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
  | 'general.navigateUp'
  | 'general.navigateSelectionUp'
  | 'general.navigateSelectionDown'
  | 'general.navigateSelectionLeft'
  | 'general.navigateSelectionRight'
  | 'general.monitorVolumeUp'
  | 'general.monitorVolumeDown';

export type HotkeyCombo = string;

const Mod = 'Control'; // Placeholder for actual mod detection logic if used here, or handled by a composable

export interface HotkeyCommand {
  id: HotkeyCommandId;
  groupId: HotkeyGroupId;
  title: string;
}

export interface HotkeyRegistry {
  commands: HotkeyCommand[];
  bindings: Partial<Record<HotkeyCommandId, HotkeyCombo[]>>;
}

export const DEFAULT_HOTKEYS: HotkeyRegistry = {
  commands: [
    { id: 'general.focus', groupId: 'general', title: 'Focus / Search' },
    { id: 'general.deselect', groupId: 'general', title: 'Deselect all' },
    { id: 'general.copy', groupId: 'general', title: 'Copy' },
    { id: 'general.cut', groupId: 'general', title: 'Cut' },
    { id: 'general.paste', groupId: 'general', title: 'Paste' },
    { id: 'general.delete', groupId: 'general', title: 'Delete' },
    { id: 'general.rename', groupId: 'general', title: 'Rename' },
    { id: 'general.undo', groupId: 'general', title: 'Undo' },
    { id: 'general.redo', groupId: 'general', title: 'Redo' },
    { id: 'general.mute', groupId: 'general', title: 'Mute / Unmute' },
    { id: 'general.addMarker', groupId: 'general', title: 'Add marker' },
    { id: 'general.volumeUp', groupId: 'general', title: 'Volume up' },
    { id: 'general.volumeDown', groupId: 'general', title: 'Volume down' },
    { id: 'general.fullscreen', groupId: 'general', title: 'Toggle fullscreen' },
    { id: 'general.zoomIn', groupId: 'general', title: 'Zoom in' },
    { id: 'general.zoomOut', groupId: 'general', title: 'Zoom out' },
    { id: 'general.zoomReset', groupId: 'general', title: 'Reset zoom' },
    { id: 'general.zoomFit', groupId: 'general', title: 'Fit to window' },
    { id: 'general.tab1', groupId: 'general', title: 'Switch to tab 1' },
    { id: 'general.tab2', groupId: 'general', title: 'Switch to tab 2' },
    { id: 'general.tab3', groupId: 'general', title: 'Switch to tab 3' },
    { id: 'general.tab4', groupId: 'general', title: 'Switch to tab 4' },
    { id: 'general.tab5', groupId: 'general', title: 'Switch to tab 5' },
    { id: 'general.tab6', groupId: 'general', title: 'Switch to tab 6' },
    { id: 'general.tab7', groupId: 'general', title: 'Switch to tab 7' },
    { id: 'general.tab8', groupId: 'general', title: 'Switch to tab 8' },
    { id: 'general.tab9', groupId: 'general', title: 'Switch to tab 9' },
    { id: 'general.switchViewFiles', groupId: 'general', title: 'Switch to Files' },
    { id: 'general.switchViewCut', groupId: 'general', title: 'Switch to Cut' },
    { id: 'general.switchViewSound', groupId: 'general', title: 'Switch to Sound' },
    { id: 'general.switchViewExport', groupId: 'general', title: 'Switch to Export' },
    { id: 'general.selectAll', groupId: 'general', title: 'Select all' },
    { id: 'general.snapshot', groupId: 'general', title: 'Create snapshot from monitor' },
    { id: 'general.newTimeline', groupId: 'general', title: 'Create new timeline' },
    { id: 'timeline.duplicate', groupId: 'timeline', title: 'Duplicate timeline / Create version' },
    { id: 'general.navigateBack', groupId: 'general', title: 'Navigate back (file manager)' },
    { id: 'general.navigateUp', groupId: 'general', title: 'Navigate up (file manager)' },
    { id: 'general.navigateSelectionUp', groupId: 'general', title: 'Navigate selection up' },
    { id: 'general.navigateSelectionDown', groupId: 'general', title: 'Navigate selection down' },
    { id: 'general.navigateSelectionLeft', groupId: 'general', title: 'Navigate selection left' },
    { id: 'general.navigateSelectionRight', groupId: 'general', title: 'Navigate selection right' },

    { id: 'timeline.toggleSnap', groupId: 'timeline', title: 'Toggle snap' },
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
    { id: 'timeline.trimToPlayheadLeft', groupId: 'timeline', title: 'Trim clip start to playhead' },
    { id: 'timeline.trimToPlayheadRight', groupId: 'timeline', title: 'Trim clip end to playhead' },
    { id: 'timeline.rippleTrimLeft', groupId: 'timeline', title: 'Ripple trim clip start to playhead' },
    { id: 'timeline.rippleTrimRight', groupId: 'timeline', title: 'Ripple trim clip end to playhead' },
    { id: 'timeline.advancedRippleTrimLeft', groupId: 'timeline', title: 'Advanced ripple trim start' },
    { id: 'timeline.advancedRippleTrimRight', groupId: 'timeline', title: 'Advanced ripple trim end' },
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
    { id: 'timeline.moveSelectedClipsLeft', groupId: 'timeline', title: 'Move selected clips left' },
    { id: 'timeline.moveSelectedClipsRight', groupId: 'timeline', title: 'Move selected clips right' },
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
    { id: 'timeline.setSelectionIn', groupId: 'timeline', title: 'Set selection In' },
    { id: 'timeline.setSelectionOut', groupId: 'timeline', title: 'Set selection Out' },

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
    'general.focus': ['/'],
    'general.deselect': ['Escape'],
    'general.copy': [`${Mod}+C`],
    'general.cut': [`${Mod}+X`],
    'general.paste': [`${Mod}+V`],
    'general.delete': ['Delete'],
    'general.rename': ['F2'],
    'general.undo': [`${Mod}+Z`],
    'general.redo': [`${Mod}+Y`, `${Mod}+Shift+Z`],
    'general.mute': ['M'],
    'general.addMarker': ['K'],
    'general.volumeUp': ['='],
    'general.volumeDown': ['-'],
    'general.fullscreen': [`${Mod}+F`],
    'general.zoomIn': [`${Mod}+=`],
    'general.zoomOut': [`${Mod}+-`],
    'general.zoomReset': [`${Mod}+0`],
    'general.zoomFit': [`${Mod}+9`],
    'general.tab1': [`${Mod}+1`],
    'general.tab2': [`${Mod}+2`],
    'general.tab3': [`${Mod}+3`],
    'general.tab4': [`${Mod}+4`],
    'general.tab5': [`${Mod}+5`],
    'general.tab6': [`${Mod}+6`],
    'general.tab7': [`${Mod}+7`],
    'general.tab8': [`${Mod}+8`],
    'general.tab9': [`${Mod}+9`],
    'general.switchViewFiles': ['Shift+1'],
    'general.switchViewCut': ['Shift+2'],
    'general.switchViewSound': ['Shift+3'],
    'general.switchViewExport': ['Shift+4'],
    'general.selectAll': [`${Mod}+A`],

    'general.snapshot': ['H'],
    'general.newTimeline': ['N'],
    'timeline.duplicate': [`${Mod}+Shift+S`],
    'general.navigateBack': ['Backspace'],
    'general.navigateUp': [`${Mod}+ArrowUp`],
    'general.navigateSelectionUp': ['ArrowUp'],
    'general.navigateSelectionDown': ['ArrowDown'],
    'general.navigateSelectionLeft': ['ArrowLeft'],
    'general.navigateSelectionRight': ['ArrowRight'],
    'general.monitorVolumeUp': ['ArrowUp'],
    'general.monitorVolumeDown': ['ArrowDown'],

    'timeline.toggleSnap': ['T'],
    'timeline.selectClipsLeftOfPlayhead': [`${Mod}+S`],
    'timeline.selectClipsRightOfPlayhead': [`${Mod}+D`],
    'timeline.trimToPlayheadLeft': ['C'],
    'timeline.trimToPlayheadRight': ['V'],
    'timeline.rippleTrimLeft': ['E'],
    'timeline.rippleTrimRight': ['R'],
    'timeline.advancedRippleTrimLeft': ['D'],
    'timeline.advancedRippleTrimRight': ['F'],
    'timeline.rippleDelete': ['Z', 'Backspace'],
    'timeline.jumpPrevBoundary': ['A'],
    'timeline.jumpNextBoundary': ['S'],
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
    'timeline.setSelectionIn': ['I'],
    'timeline.setSelectionOut': ['O'],

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
