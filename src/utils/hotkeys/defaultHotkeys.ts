export type HotkeyGroupId =
  | 'general'
  | 'fileManager'
  | 'timeline'
  | 'timelineMonitorGlobal'
  | 'monitor';

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
  | 'general.projectTabFiles'
  | 'general.projectTabHistory'
  | 'general.projectTabEffects'
  | 'general.projectTabLibrary'
  | 'general.projectTabMarkers'
  | 'general.projectTabBackups'
  | 'general.backgroundTasks'
  | 'general.projectSettings'
  | 'general.appSettings'
  | 'general.selectAll'
  | 'general.snapshot'
  | 'general.newTimeline'
  | 'timeline.duplicate'
  | 'timeline.addTextClipAtPlayhead'
  | 'timeline.addBackgroundClipAtPlayhead'
  | 'timeline.addAdjustmentClipAtPlayhead'
  | 'timeline.selectSnapModeSnap'
  | 'timeline.selectSnapModeNoSnap'
  | 'timeline.selectSnapModeFree'
  | 'timeline.selectDragModeMove'
  | 'timeline.selectDragModePseudoOverlap'
  | 'timeline.selectDragModeSlip'
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
  | 'timeline.globalToStart'
  | 'timeline.globalToEnd'
  | 'timeline.toggleBladeTool'
  | 'timeline.reverseSpeed'
  | 'timeline.openSpeedModal'
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
  | 'playback.jumpPrevBoundary'
  | 'playback.jumpNextBoundary'
  | 'playback.jumpPrevBoundaryTrack'
  | 'playback.jumpNextBoundaryTrack'
  | 'general.navigateBack'
  | 'general.navigateForward'
  | 'general.navigateUp'
  | 'general.createFolder';
// Note: ArrowUp, ArrowDown, ArrowLeft, and ArrowRight keys for list selection
// are handled locally inside the file browser components and are intentionally
// excluded from global customizable hotkeys to avoid breaking standard inputs/dropdowns.

export type HotkeyCombo = string;

const Mod = 'Ctrl';

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
    // General - Часто используемые операции редактирования
    { id: 'general.copy', groupId: 'general', title: 'Copy' },
    { id: 'general.cut', groupId: 'general', title: 'Cut' },
    { id: 'general.paste', groupId: 'general', title: 'Paste' },
    { id: 'general.delete', groupId: 'general', title: 'Delete' },
    { id: 'general.undo', groupId: 'general', title: 'Undo' },
    { id: 'general.redo', groupId: 'general', title: 'Redo' },
    { id: 'general.save', groupId: 'general', title: 'Save' },
    { id: 'general.selectAll', groupId: 'general', title: 'Select all' },
    { id: 'general.deselect', groupId: 'general', title: 'Deselect all / Close modals' },
    { id: 'general.focus', groupId: 'general', title: 'Focus / Search' },
    { id: 'general.rename', groupId: 'general', title: 'Rename' },

    // Зум операции
    { id: 'general.zoomIn', groupId: 'general', title: 'Zoom in' },
    { id: 'general.zoomOut', groupId: 'general', title: 'Zoom out' },
    { id: 'general.zoomReset', groupId: 'general', title: 'Reset zoom' },
    { id: 'general.zoomFit', groupId: 'general', title: 'Fit to window' },

    // Переключение видов (View)
    { id: 'general.switchViewFiles', groupId: 'general', title: 'Switch to Files' },
    { id: 'general.switchViewCut', groupId: 'general', title: 'Switch to Cut' },
    { id: 'general.switchViewSound', groupId: 'general', title: 'Switch to Sound' },
    { id: 'general.switchViewEffects', groupId: 'general', title: 'Switch to Effects' },
    { id: 'general.switchViewExport', groupId: 'general', title: 'Switch to Export' },

    // Табы проекта
    { id: 'general.projectTabFiles', groupId: 'general', title: 'Switch to Files tab' },
    { id: 'general.projectTabHistory', groupId: 'general', title: 'Switch to History tab' },
    { id: 'general.projectTabEffects', groupId: 'general', title: 'Switch to Effects tab' },
    { id: 'general.projectTabLibrary', groupId: 'general', title: 'Switch to Library tab' },
    { id: 'general.projectTabMarkers', groupId: 'general', title: 'Switch to Markers tab' },
    { id: 'general.projectTabBackups', groupId: 'general', title: 'Switch to Backups tab' },

    // Табы таймлайна
    { id: 'general.tab1', groupId: 'general', title: 'Switch to tab 1' },
    { id: 'general.tab2', groupId: 'general', title: 'Switch to tab 2' },
    { id: 'general.tab3', groupId: 'general', title: 'Switch to tab 3' },
    { id: 'general.tab4', groupId: 'general', title: 'Switch to tab 4' },
    { id: 'general.tab5', groupId: 'general', title: 'Switch to tab 5' },
    { id: 'general.tab6', groupId: 'general', title: 'Switch to tab 6' },
    { id: 'general.tab7', groupId: 'general', title: 'Switch to tab 7' },
    { id: 'general.tab8', groupId: 'general', title: 'Switch to tab 8' },
    { id: 'general.tab9', groupId: 'general', title: 'Switch to tab 9' },

    // Прочие общие операции
    { id: 'general.fullscreen', groupId: 'general', title: 'Toggle fullscreen' },
    { id: 'general.newTimeline', groupId: 'general', title: 'Create new timeline' },
    { id: 'general.backgroundTasks', groupId: 'general', title: 'Show background tasks' },
    { id: 'general.projectSettings', groupId: 'general', title: 'Open project settings' },
    { id: 'general.appSettings', groupId: 'general', title: 'Open application settings' },

    // File Manager
    { id: 'general.navigateBack', groupId: 'fileManager', title: 'Navigate back' },
    { id: 'general.navigateForward', groupId: 'fileManager', title: 'Navigate forward' },
    { id: 'general.navigateUp', groupId: 'fileManager', title: 'Navigate up' },
    { id: 'general.createFolder', groupId: 'fileManager', title: 'Create folder' },

    // Timeline & Monitor Global - Playback
    { id: 'playback.toggle', groupId: 'timelineMonitorGlobal', title: 'Toggle playback' },
    {
      id: 'playback.toggle1',
      groupId: 'timelineMonitorGlobal',
      title: 'Toggle playback (secondary)',
    },
    { id: 'playback.backward1', groupId: 'timelineMonitorGlobal', title: 'Backward 1x' },
    {
      id: 'timeline.globalToStart',
      groupId: 'timelineMonitorGlobal',
      title: 'Go to start of timeline',
    },
    {
      id: 'timeline.globalToEnd',
      groupId: 'timelineMonitorGlobal',
      title: 'Go to end of timeline',
    },

    // Timeline & Monitor Global - Громкость
    { id: 'general.mute', groupId: 'timelineMonitorGlobal', title: 'Mute / Unmute' },
    { id: 'general.volumeUp', groupId: 'timelineMonitorGlobal', title: 'Increase monitor volume' },
    {
      id: 'general.volumeDown',
      groupId: 'timelineMonitorGlobal',
      title: 'Decrease monitor volume',
    },

    // Timeline & Monitor Global - Маркеры
    { id: 'general.addMarker', groupId: 'timelineMonitorGlobal', title: 'Add marker' },
    { id: 'general.prevMarker', groupId: 'timelineMonitorGlobal', title: 'Previous marker' },
    { id: 'general.nextMarker', groupId: 'timelineMonitorGlobal', title: 'Next marker' },

    // Timeline & Monitor Global - Selection/Boundaries
    { id: 'timeline.setSelectionIn', groupId: 'timelineMonitorGlobal', title: 'Set selection In' },
    {
      id: 'timeline.setSelectionOut',
      groupId: 'timelineMonitorGlobal',
      title: 'Set selection Out',
    },
    {
      id: 'playback.jumpPrevBoundary',
      groupId: 'timelineMonitorGlobal',
      title: 'Jump to previous edit point',
    },
    {
      id: 'playback.jumpNextBoundary',
      groupId: 'timelineMonitorGlobal',
      title: 'Jump to next edit point',
    },
    {
      id: 'playback.jumpPrevBoundaryTrack',
      groupId: 'timelineMonitorGlobal',
      title: 'Jump to previous edit point on track',
    },
    {
      id: 'playback.jumpNextBoundaryTrack',
      groupId: 'timelineMonitorGlobal',
      title: 'Jump to next edit point on track',
    },

    // Timeline & Monitor Global - Snapshot
    {
      id: 'general.snapshot',
      groupId: 'timelineMonitorGlobal',
      title: 'Create snapshot from monitor',
    },

    // Timeline - Основные операции редактирования
    { id: 'timeline.splitAtPlayhead', groupId: 'timeline', title: 'Split at playhead' },
    { id: 'timeline.splitAllAtPlayhead', groupId: 'timeline', title: 'Split all at playhead' },
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
    { id: 'timeline.rippleDelete', groupId: 'timeline', title: 'Ripple delete' },
    {
      id: 'timeline.rippleDeleteSelectedClipRange',
      groupId: 'timeline',
      title: 'Ripple delete selected clip range on all tracks',
    },

    // Timeline - Выделение
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

    // Timeline - Перемещение
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

    // Timeline - Режимы snapping и drag
    { id: 'timeline.selectSnapModeSnap', groupId: 'timeline', title: 'Switch to clip snapping' },
    { id: 'timeline.selectSnapModeNoSnap', groupId: 'timeline', title: 'Switch to no snapping' },
    { id: 'timeline.selectSnapModeFree', groupId: 'timeline', title: 'Switch to free mode' },
    { id: 'timeline.selectDragModeMove', groupId: 'timeline', title: 'Switch to normal move mode' },
    {
      id: 'timeline.selectDragModePseudoOverlap',
      groupId: 'timeline',
      title: 'Switch to pseudo-overlap mode',
    },
    { id: 'timeline.selectDragModeSlip', groupId: 'timeline', title: 'Switch to slip mode' },

    // Timeline - Тогглы клипов
    { id: 'timeline.toggleDisableClip', groupId: 'timeline', title: 'Disable / Enable clip' },
    { id: 'timeline.toggleMuteClip', groupId: 'timeline', title: 'Mute / Unmute clip' },
    {
      id: 'timeline.toggleLockClip',
      groupId: 'timeline',
      title: 'Toggle lock clip',
    },
    {
      id: 'timeline.toggleFreezeFrame',
      groupId: 'timeline',
      title: 'Toggle clip freeze frame',
    },

    // Timeline - Тогглы дорожек
    {
      id: 'timeline.toggleVisibilityTrack',
      groupId: 'timeline',
      title: 'Hide / Show video track',
    },
    { id: 'timeline.toggleMuteTrack', groupId: 'timeline', title: 'Mute / Unmute audio track' },
    { id: 'timeline.toggleSoloTrack', groupId: 'timeline', title: 'Solo / Unsolo audio track' },
    {
      id: 'timeline.toggleLockTrack',
      groupId: 'timeline',
      title: 'Toggle lock track',
    },

    // Timeline - Параметры клипов
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

    // Timeline - Вейвформа и миниатюры
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

    // Timeline - Громкость клипов
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

    // Timeline - Создание клипов
    {
      id: 'timeline.addTextClipAtPlayhead',
      groupId: 'timeline',
      title: 'Create text clip at playhead',
    },
    {
      id: 'timeline.addBackgroundClipAtPlayhead',
      groupId: 'timeline',
      title: 'Create background clip at playhead',
    },
    {
      id: 'timeline.addAdjustmentClipAtPlayhead',
      groupId: 'timeline',
      title: 'Create adjustment clip at playhead',
    },

    // Timeline - Прочее
    { id: 'timeline.duplicate', groupId: 'timeline', title: 'Duplicate timeline / Create version' },
    { id: 'timeline.centerPlayhead', groupId: 'timeline', title: 'Center playhead' },
    { id: 'timeline.toggleBladeTool', groupId: 'timeline', title: 'Toggle blade tool' },
    { id: 'timeline.reverseSpeed', groupId: 'timeline', title: 'Reverse speed' },
    { id: 'timeline.openSpeedModal', groupId: 'timeline', title: 'Open speed modal' },

    // Monitor - Навигация и шаги
    { id: 'playback.stepForward', groupId: 'monitor', title: 'Step forward' },
    { id: 'playback.stepBackward', groupId: 'monitor', title: 'Step backward' },
    { id: 'playback.stepForwardLarge', groupId: 'monitor', title: 'Step forward (large)' },
    { id: 'playback.stepBackwardLarge', groupId: 'monitor', title: 'Step backward (large)' },
    { id: 'playback.toStart', groupId: 'monitor', title: 'Go to start' },
    { id: 'playback.toEnd', groupId: 'monitor', title: 'Go to end' },

    // Monitor - Скорости воспроизведения (от частых к редким)
    { id: 'playback.forward1_5', groupId: 'monitor', title: 'Forward 1.5x' },
    { id: 'playback.backward1_5', groupId: 'monitor', title: 'Backward 1.5x' },
    { id: 'playback.forward2', groupId: 'monitor', title: 'Forward 2x' },
    { id: 'playback.backward2', groupId: 'monitor', title: 'Backward 2x' },
    { id: 'playback.forward3', groupId: 'monitor', title: 'Forward 3x' },
    { id: 'playback.backward3', groupId: 'monitor', title: 'Backward 3x' },
    { id: 'playback.forward5', groupId: 'monitor', title: 'Forward 5x' },
    { id: 'playback.backward5', groupId: 'monitor', title: 'Backward 5x' },
    { id: 'playback.forward1_25', groupId: 'monitor', title: 'Forward 1.25x' },
    { id: 'playback.backward1_25', groupId: 'monitor', title: 'Backward 1.25x' },
    { id: 'playback.forward1_75', groupId: 'monitor', title: 'Forward 1.75x' },
    { id: 'playback.backward1_75', groupId: 'monitor', title: 'Backward 1.75x' },
    { id: 'playback.forward0_75', groupId: 'monitor', title: 'Forward 0.75x' },
    { id: 'playback.backward0_75', groupId: 'monitor', title: 'Backward 0.75x' },
    { id: 'playback.forward0_5', groupId: 'monitor', title: 'Forward 0.5x' },
    { id: 'playback.backward0_5', groupId: 'monitor', title: 'Backward 0.5x' },
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
    'general.newTimeline': [`${Mod}+N`],

    'general.mute': [`${Mod}+Q`],
    'general.volumeUp': [`${Mod}+R`],
    'general.volumeDown': [`${Mod}+E`],
    'general.snapshot': [`${Mod}+H`],
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
    'general.projectTabFiles': ['Shift+H'],
    'general.projectTabHistory': ['Shift+J'],
    'general.projectTabEffects': ['Shift+K'],
    'general.projectTabLibrary': ['Shift+L'],
    'general.projectTabMarkers': ['Shift+;'],
    'general.projectTabBackups': ["Shift+'"],
    'general.backgroundTasks': ['Shift+Y'],
    'general.projectSettings': ['Shift+U'],
    'general.appSettings': ['Shift+I'],

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
    'general.createFolder': ['Ctrl+\\'],

    'timeline.addTextClipAtPlayhead': ['N'],
    'timeline.addBackgroundClipAtPlayhead': ['U'],
    'timeline.addAdjustmentClipAtPlayhead': ['Y'],
    'timeline.selectSnapModeSnap': ['H'],
    'timeline.selectSnapModeNoSnap': ['J'],
    'timeline.selectSnapModeFree': ['K'],
    'timeline.selectDragModeMove': ['L'],
    'timeline.selectDragModePseudoOverlap': [';'],
    'timeline.selectDragModeSlip': ["'"],
    'timeline.selectClipsLeftOfPlayhead': ['C'],
    'timeline.selectClipsRightOfPlayhead': ['V'],
    'timeline.trimToPlayheadLeft': ['D'],
    'timeline.trimToPlayheadRight': ['F'],
    'timeline.rippleTrimLeft': ['Shift+E'],
    'timeline.rippleTrimRight': ['Shift+R'],
    'timeline.advancedRippleTrimLeft': ['E'],
    'timeline.advancedRippleTrimRight': ['R'],
    'timeline.rippleDeleteSelectedClipRange': ['Z'],
    'timeline.rippleDelete': ['Shift+Z', 'Backspace'],
    'timeline.splitAtPlayhead': ['G'],
    'timeline.splitAllAtPlayhead': ['Shift+G'],
    'timeline.toggleDisableClip': ['W'],
    'timeline.toggleMuteClip': ['Q'],
    'timeline.toggleVisibilityTrack': ['Shift+W'],
    'timeline.toggleMuteTrack': ['Shift+Q'],
    'timeline.toggleSoloTrack': ['B'],
    'timeline.moveSelectedClipsLeft': [`${Mod}+ArrowLeft`],
    'timeline.moveSelectedClipsRight': [`${Mod}+ArrowRight`],
    'timeline.moveSelectedClipsLeftLarge': [`${Mod}+Shift+ArrowLeft`],
    'timeline.moveSelectedClipsRightLarge': [`${Mod}+Shift+ArrowRight`],
    'timeline.increaseSelectedClipsVolume': ['Ctrl+ArrowUp'],
    'timeline.decreaseSelectedClipsVolume': ['Ctrl+ArrowDown'],
    'timeline.increaseSelectedClipsVolumeLarge': ['Ctrl+Shift+ArrowUp'],
    'timeline.decreaseSelectedClipsVolumeLarge': ['Ctrl+Shift+ArrowDown'],
    'timeline.copyClipParameters': ['Shift+C'],
    'timeline.pasteClipParameters': ['Shift+V'],
    'timeline.toggleWaveformMode': ['Shift+X'],
    'timeline.toggleShowWaveform': ['Shift+D'],
    'timeline.toggleShowThumbnails': ['Shift+F'],
    'timeline.toggleFreezeFrame': ['Shift+B'],
    'timeline.toggleLockClip': ['T'],
    'timeline.toggleLockTrack': ['Shift+T'],
    'timeline.setSelectionIn': ['I'],
    'timeline.setSelectionOut': ['O'],
    'timeline.centerPlayhead': ['Shift+/'],
    'timeline.toggleBladeTool': ['/'],
    'timeline.reverseSpeed': ['P'],
    'timeline.openSpeedModal': [`${Mod}+P`],

    'playback.toggle': ['Space'],
    'playback.toggle1': ['Shift+Space'],
    'playback.toStart': ['W'],
    'playback.toEnd': ['T'],
    'timeline.globalToStart': ['Home'],
    'timeline.globalToEnd': ['End'],
    'playback.stepForward': ['ArrowRight'],
    'playback.stepBackward': ['ArrowLeft'],
    'playback.stepForwardLarge': ['Shift+ArrowRight'],
    'playback.stepBackwardLarge': ['Shift+ArrowLeft'],
    'playback.forward1_25': [],
    'playback.backward1_25': ['Shift+O'],
    'playback.forward1_5': ['F'],
    'playback.backward1_5': ['D'],
    'playback.forward1_75': ['Shift+R'],
    'playback.backward1_75': ['Shift+E'],
    'playback.forward2': ['R'],
    'playback.backward2': ['E'],
    'playback.forward3': ['Shift+G'],
    'playback.backward3': ['Shift+Z'],
    'playback.forward5': ['G'],
    'playback.backward5': ['Z'],
    'playback.forward0_75': ['Shift+V'],
    'playback.backward0_75': ['Shift+C'],
    'playback.forward0_5': ['V'],
    'playback.backward0_5': ['C'],
    'playback.backward1': [`${Mod}+Space`],
    'playback.jumpPrevBoundary': ['A', 'MouseForward', 'ArrowUp'],
    'playback.jumpNextBoundary': ['S', 'MouseBack', 'ArrowDown'],
    'playback.jumpPrevBoundaryTrack': ['Shift+A', 'Shift+ArrowUp'],
    'playback.jumpNextBoundaryTrack': ['Shift+S', 'Shift+ArrowDown'],
  },
};
