export type HotkeyGroupId = 'general' | 'playback' | 'timeline';

export type HotkeyCommandId =
  | 'general.focus'
  | 'general.delete'
  | 'general.undo'
  | 'general.redo'
  | 'timeline.deleteClip'
  | 'playback.toggle'
  | 'playback.toStart'
  | 'playback.toEnd';

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

    { id: 'timeline.deleteClip', groupId: 'timeline', title: 'Delete clip' },

    { id: 'playback.toggle', groupId: 'playback', title: 'Play / pause' },
    { id: 'playback.toStart', groupId: 'playback', title: 'Go to start' },
    { id: 'playback.toEnd', groupId: 'playback', title: 'Go to end' },
  ],
  bindings: {
    'general.focus': ['Tab'],
    'general.delete': ['Delete'],
    'general.undo': ['Ctrl+Z'],
    'general.redo': ['Ctrl+Shift+Z'],

    'timeline.deleteClip': ['X'],

    'playback.toggle': ['Space'],
    'playback.toStart': ['W'],
    'playback.toEnd': ['T'],
  },
};
