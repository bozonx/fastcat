export type HotkeyGroupId = 'general' | 'playback' | 'timeline';

export type HotkeyCommandId =
  | 'general.focus'
  | 'general.deselect'
  | 'general.delete'
  | 'general.undo'
  | 'general.redo'
  | 'general.mute'
  | 'general.volumeUp'
  | 'general.volumeDown'
  | 'timeline.zoomIn'
  | 'timeline.zoomOut'
  | 'timeline.zoomReset'
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
  | 'timeline.tab1'
  | 'timeline.tab2'
  | 'timeline.tab3'
  | 'timeline.tab4'
  | 'timeline.tab5'
  | 'timeline.tab6'
  | 'timeline.tab7'
  | 'timeline.tab8'
  | 'timeline.tab9'
  | 'playback.toggle'
  | 'playback.toStart'
  | 'playback.toEnd'
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
  | 'playback.backward1';

export interface HotkeyCommandDefinition {
  id: HotkeyCommandId;
  groupId: HotkeyGroupId;
  title: string;
}

export type HotkeyCombo = string;

export interface DefaultHotkeysConfig {
  commands: readonly HotkeyCommandDefinition[];
  bindings: Record<HotkeyCommandId, HotkeyCombo[]>;
}

export const DEFAULT_HOTKEYS: DefaultHotkeysConfig = {
  commands: [
    { id: 'general.focus', groupId: 'general', title: 'Focus' },
    { id: 'general.deselect', groupId: 'general', title: 'Deselect' },
    { id: 'general.delete', groupId: 'general', title: 'Delete' },
    { id: 'general.undo', groupId: 'general', title: 'Undo' },
    { id: 'general.redo', groupId: 'general', title: 'Redo' },
    { id: 'general.mute', groupId: 'general', title: 'Toggle Mute' },
    { id: 'general.volumeUp', groupId: 'general', title: 'Volume Up' },
    { id: 'general.volumeDown', groupId: 'general', title: 'Volume Down' },
    { id: 'playback.toggle', groupId: 'general', title: 'Play / pause (normal speed)' },

    { id: 'timeline.zoomIn', groupId: 'timeline', title: 'Zoom in' },
    { id: 'timeline.zoomOut', groupId: 'timeline', title: 'Zoom out' },
    { id: 'timeline.zoomReset', groupId: 'timeline', title: 'Reset zoom' },
    {
      id: 'timeline.trimToPlayheadLeft',
      groupId: 'timeline',
      title: 'Trim clip to playhead (remove right part, no ripple)',
    },
    {
      id: 'timeline.trimToPlayheadRight',
      groupId: 'timeline',
      title: 'Trim clip to playhead (remove left part, no ripple)',
    },
    {
      id: 'timeline.rippleTrimLeft',
      groupId: 'timeline',
      title: 'Ripple trim to playhead (remove left part)',
    },
    {
      id: 'timeline.rippleTrimRight',
      groupId: 'timeline',
      title: 'Ripple trim to playhead (remove right part)',
    },
    {
      id: 'timeline.advancedRippleTrimLeft',
      groupId: 'timeline',
      title: 'Advanced ripple trim to playhead (remove left part, all tracks)',
    },
    {
      id: 'timeline.advancedRippleTrimRight',
      groupId: 'timeline',
      title: 'Advanced ripple trim to playhead (remove right part, all tracks)',
    },
    {
      id: 'timeline.rippleDelete',
      groupId: 'timeline',
      title: 'Ripple delete selected clip(s)',
    },
    {
      id: 'timeline.jumpPrevBoundary',
      groupId: 'timeline',
      title: 'Jump to previous clip boundary',
    },
    { id: 'timeline.jumpNextBoundary', groupId: 'timeline', title: 'Jump to next clip boundary' },
    {
      id: 'timeline.jumpPrevBoundaryTrack',
      groupId: 'timeline',
      title: 'Jump to previous clip boundary (current track)',
    },
    {
      id: 'timeline.jumpNextBoundaryTrack',
      groupId: 'timeline',
      title: 'Jump to next clip boundary (current track)',
    },
    { id: 'timeline.splitAtPlayhead', groupId: 'timeline', title: 'Split clip at playhead' },
    {
      id: 'timeline.splitAllAtPlayhead',
      groupId: 'timeline',
      title: 'Split all clips at playhead',
    },
    { id: 'timeline.toggleDisableClip', groupId: 'timeline', title: 'Disable / enable clip' },
    { id: 'timeline.toggleMuteClip', groupId: 'timeline', title: 'Mute / unmute clip' },
    { id: 'timeline.toggleVisibilityTrack', groupId: 'timeline', title: 'Toggle track visibility' },
    { id: 'timeline.toggleMuteTrack', groupId: 'timeline', title: 'Toggle track mute' },
    { id: 'timeline.toggleSoloTrack', groupId: 'timeline', title: 'Toggle track solo' },
    { id: 'timeline.tab1', groupId: 'timeline', title: 'Timeline Tab 1' },
    { id: 'timeline.tab2', groupId: 'timeline', title: 'Timeline Tab 2' },
    { id: 'timeline.tab3', groupId: 'timeline', title: 'Timeline Tab 3' },
    { id: 'timeline.tab4', groupId: 'timeline', title: 'Timeline Tab 4' },
    { id: 'timeline.tab5', groupId: 'timeline', title: 'Timeline Tab 5' },
    { id: 'timeline.tab6', groupId: 'timeline', title: 'Timeline Tab 6' },
    { id: 'timeline.tab7', groupId: 'timeline', title: 'Timeline Tab 7' },
    { id: 'timeline.tab8', groupId: 'timeline', title: 'Timeline Tab 8' },
    { id: 'timeline.tab9', groupId: 'timeline', title: 'Timeline Tab 9' },

    { id: 'playback.toStart', groupId: 'playback', title: 'Go to start' },
    { id: 'playback.toEnd', groupId: 'playback', title: 'Go to end' },
    { id: 'playback.forward1_25', groupId: 'playback', title: 'Forward x1.25' },
    { id: 'playback.backward1_25', groupId: 'playback', title: 'Backward x1.25' },
    { id: 'playback.forward1_5', groupId: 'playback', title: 'Forward x1.5' },
    { id: 'playback.backward1_5', groupId: 'playback', title: 'Backward x1.5' },
    { id: 'playback.forward1_75', groupId: 'playback', title: 'Forward x1.75' },
    { id: 'playback.backward1_75', groupId: 'playback', title: 'Backward x1.75' },
    { id: 'playback.forward2', groupId: 'playback', title: 'Forward x2' },
    { id: 'playback.backward2', groupId: 'playback', title: 'Backward x2' },
    { id: 'playback.forward3', groupId: 'playback', title: 'Forward x3' },
    { id: 'playback.backward3', groupId: 'playback', title: 'Backward x3' },
    { id: 'playback.forward5', groupId: 'playback', title: 'Forward x5' },
    { id: 'playback.backward5', groupId: 'playback', title: 'Backward x5' },
    { id: 'playback.forward0_75', groupId: 'playback', title: 'Forward x0.75' },
    { id: 'playback.backward0_75', groupId: 'playback', title: 'Backward x0.75' },
    { id: 'playback.forward0_5', groupId: 'playback', title: 'Forward x0.5' },
    { id: 'playback.backward0_5', groupId: 'playback', title: 'Backward x0.5' },
    { id: 'playback.backward1', groupId: 'playback', title: 'Backward x1' },
  ],
  bindings: {
    'general.focus': ['Tab'],
    'general.deselect': ['Escape'],
    'general.delete': ['Delete', 'X'],
    'general.undo': ['Ctrl+Z'],
    'general.redo': ['Ctrl+Shift+Z'],
    'general.mute': ['Ctrl+Q'],
    'general.volumeUp': ['Ctrl+R'],
    'general.volumeDown': ['Ctrl+E'],

    'timeline.zoomIn': ['='],
    'timeline.zoomOut': ['-'],
    'timeline.zoomReset': ['0', '.'],
    'timeline.trimToPlayheadLeft': ['V'],
    'timeline.trimToPlayheadRight': ['C'],
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
    'timeline.tab1': ['1'],
    'timeline.tab2': ['2'],
    'timeline.tab3': ['3'],
    'timeline.tab4': ['4'],
    'timeline.tab5': ['5'],
    'timeline.tab6': ['6'],
    'timeline.tab7': ['7'],
    'timeline.tab8': ['8'],
    'timeline.tab9': ['9'],

    'playback.toggle': ['Space'],
    'playback.toStart': ['Home'],
    'playback.toEnd': ['End'],
    'playback.forward1_25': [],
    'playback.backward1_25': [],
    'playback.forward1_5': ['Shift+F'],
    'playback.backward1_5': ['Shift+D'],
    'playback.forward1_75': [],
    'playback.backward1_75': [],
    'playback.forward2': ['Shift+R'],
    'playback.backward2': ['Shift+E'],
    'playback.forward3': [],
    'playback.backward3': [],
    'playback.forward5': [],
    'playback.backward5': [],
    'playback.forward0_75': [],
    'playback.backward0_75': [],
    'playback.forward0_5': ['Shift+V'],
    'playback.backward0_5': ['Shift+C'],
    'playback.backward1': [],
  },
};

