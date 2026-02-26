export type HotkeyGroupId = 'general' | 'playback' | 'timeline' | 'audio';

export type HotkeyCommandId =
  | 'general.focus'
  | 'general.delete'
  | 'general.undo'
  | 'general.redo'
  | 'timeline.deleteClip'
  | 'timeline.trimToPlayheadLeft'
  | 'timeline.trimToPlayheadRight'
  | 'timeline.jumpPrevBoundary'
  | 'timeline.jumpNextBoundary'
  | 'timeline.jumpPrevBoundaryTrack'
  | 'timeline.jumpNextBoundaryTrack'
  | 'timeline.splitAtPlayhead'
  | 'timeline.splitAllAtPlayhead'
  | 'timeline.toggleDisableClip'
  | 'timeline.toggleMuteClip'
  | 'timeline.tab1'
  | 'timeline.tab2'
  | 'timeline.tab3'
  | 'timeline.tab4'
  | 'timeline.tab5'
  | 'timeline.tab6'
  | 'timeline.tab7'
  | 'timeline.tab8'
  | 'timeline.tab9'
  | 'timeline.tab10'
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
  | 'playback.backward1'
  | 'audio.mute'
  | 'audio.volumeUp'
  | 'audio.volumeDown';

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
    { id: 'general.delete', groupId: 'general', title: 'Delete' },
    { id: 'general.undo', groupId: 'general', title: 'Undo' },
    { id: 'general.redo', groupId: 'general', title: 'Redo' },
    { id: 'playback.toggle', groupId: 'general', title: 'Play / pause (normal speed)' },

    { id: 'timeline.deleteClip', groupId: 'timeline', title: 'Delete clip' },
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
    { id: 'timeline.tab1', groupId: 'timeline', title: 'Timeline Tab 1' },
    { id: 'timeline.tab2', groupId: 'timeline', title: 'Timeline Tab 2' },
    { id: 'timeline.tab3', groupId: 'timeline', title: 'Timeline Tab 3' },
    { id: 'timeline.tab4', groupId: 'timeline', title: 'Timeline Tab 4' },
    { id: 'timeline.tab5', groupId: 'timeline', title: 'Timeline Tab 5' },
    { id: 'timeline.tab6', groupId: 'timeline', title: 'Timeline Tab 6' },
    { id: 'timeline.tab7', groupId: 'timeline', title: 'Timeline Tab 7' },
    { id: 'timeline.tab8', groupId: 'timeline', title: 'Timeline Tab 8' },
    { id: 'timeline.tab9', groupId: 'timeline', title: 'Timeline Tab 9' },
    { id: 'timeline.tab10', groupId: 'timeline', title: 'Timeline Tab 10' },

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

    { id: 'audio.mute', groupId: 'audio', title: 'Mute' },
    { id: 'audio.volumeUp', groupId: 'audio', title: 'Volume Up' },
    { id: 'audio.volumeDown', groupId: 'audio', title: 'Volume Down' },
  ],
  bindings: {
    'general.focus': ['Tab'],
    'general.delete': ['Delete'],
    'general.undo': ['Ctrl+Z'],
    'general.redo': ['Ctrl+Shift+Z'],

    'timeline.deleteClip': ['Delete'],
    'timeline.trimToPlayheadLeft': ['V'],
    'timeline.trimToPlayheadRight': ['C'],
    'timeline.jumpPrevBoundary': ['A'],
    'timeline.jumpNextBoundary': ['S'],
    'timeline.jumpPrevBoundaryTrack': ['Shift+A'],
    'timeline.jumpNextBoundaryTrack': ['Shift+S'],
    'timeline.splitAtPlayhead': ['G'],
    'timeline.splitAllAtPlayhead': ['Shift+G'],
    'timeline.toggleDisableClip': ['Q'],
    'timeline.toggleMuteClip': ['W'],
    'timeline.tab1': ['1'],
    'timeline.tab2': ['2'],
    'timeline.tab3': ['3'],
    'timeline.tab4': ['4'],
    'timeline.tab5': ['5'],
    'timeline.tab6': ['6'],
    'timeline.tab7': ['7'],
    'timeline.tab8': ['8'],
    'timeline.tab9': ['9'],
    'timeline.tab10': ['0'],

    'playback.toggle': ['Space'],
    'playback.toStart': ['W'],
    'playback.toEnd': ['T'],
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

    'audio.mute': ['Q'],
    'audio.volumeUp': ['X'],
    'audio.volumeDown': ['Z'],
  },
};
