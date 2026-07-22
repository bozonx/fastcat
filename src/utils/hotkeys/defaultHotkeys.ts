export type HotkeyGroupId =
  'general' | 'fileManager' | 'timeline' | 'timelineMonitorGlobal' | 'monitor';

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
  | 'monitor.center'
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
  | 'timeline.groupClips'
  | 'timeline.ungroupClips'
  | 'playback.toggle'
  | 'playback.toggle1'
  | 'playback.play1ResetSpeed'
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
  | 'playback.speedUpForward'
  | 'playback.speedDown'
  | 'playback.shuttleForward'
  | 'playback.shuttleReverse'
  | 'playback.shuttleStop'
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

const Modifier1 = 'Modifier1';
const Modifier2 = 'Modifier2';

export interface HotkeyCommand {
  id: HotkeyCommandId;
  groupId: HotkeyGroupId;
  title: string;
  visibility?: 'default' | 'advanced' | 'hidden';
}

export interface HotkeyCommandDefinition {
  id: HotkeyCommandId;
  groupId: HotkeyGroupId;
  title: string;
  description?: string;
  visibility?: 'default' | 'advanced' | 'hidden';
}

export interface HotkeyRegistry {
  commands: HotkeyCommand[];
  bindings: Partial<Record<HotkeyCommandId, HotkeyCombo[]>>;
}

export const DEFAULT_HOTKEYS: HotkeyRegistry = {
  commands: [
    // General - Common editing operations
    { id: 'general.copy', groupId: 'general', title: 'Copy' },
    { id: 'general.cut', groupId: 'general', title: 'Cut' },
    { id: 'general.paste', groupId: 'general', title: 'Paste' },
    { id: 'general.delete', groupId: 'general', title: 'Delete' },
    { id: 'general.undo', groupId: 'general', title: 'Undo' },
    { id: 'general.redo', groupId: 'general', title: 'Redo' },
    { id: 'general.save', groupId: 'general', title: 'Save' },
    { id: 'general.selectAll', groupId: 'general', title: 'Select all' },
    { id: 'general.deselect', groupId: 'general', title: 'Deselect all / Cancel' },
    { id: 'general.focus', groupId: 'general', title: 'Focus / Search' },
    { id: 'general.rename', groupId: 'general', title: 'Rename' },

    // General - Zoom and fullscreen
    { id: 'general.fullscreen', groupId: 'general', title: 'Toggle fullscreen' },
    { id: 'general.zoomIn', groupId: 'general', title: 'Zoom in' },
    { id: 'general.zoomOut', groupId: 'general', title: 'Zoom out' },
    { id: 'general.zoomReset', groupId: 'general', title: 'Reset zoom' },
    { id: 'general.zoomFit', groupId: 'general', title: 'Fit to window' },

    // General - View switching
    { id: 'general.switchViewFiles', groupId: 'general', title: 'Switch to Files' },
    { id: 'general.switchViewCut', groupId: 'general', title: 'Switch to Cut' },
    { id: 'general.switchViewSound', groupId: 'general', title: 'Switch to Sound' },
    { id: 'general.switchViewEffects', groupId: 'general', title: 'Switch to Effects' },
    { id: 'general.switchViewExport', groupId: 'general', title: 'Switch to Export' },

    // General - Project tabs
    {
      id: 'general.projectTabFiles',
      groupId: 'general',
      title: 'Switch to Files tab',
      visibility: 'advanced',
    },
    {
      id: 'general.projectTabHistory',
      groupId: 'general',
      title: 'Switch to History tab',
      visibility: 'advanced',
    },
    {
      id: 'general.projectTabEffects',
      groupId: 'general',
      title: 'Switch to Effects tab',
      visibility: 'advanced',
    },
    {
      id: 'general.projectTabLibrary',
      groupId: 'general',
      title: 'Switch to Library tab',
      visibility: 'advanced',
    },
    {
      id: 'general.projectTabMarkers',
      groupId: 'general',
      title: 'Switch to Markers tab',
      visibility: 'advanced',
    },
    {
      id: 'general.projectTabBackups',
      groupId: 'general',
      title: 'Switch to Backups tab',
      visibility: 'advanced',
    },

    // General - Timeline tabs
    {
      id: 'general.tab1',
      groupId: 'general',
      title: 'Switch to timeline tab 1',
      visibility: 'advanced',
    },
    {
      id: 'general.tab2',
      groupId: 'general',
      title: 'Switch to timeline tab 2',
      visibility: 'advanced',
    },
    {
      id: 'general.tab3',
      groupId: 'general',
      title: 'Switch to timeline tab 3',
      visibility: 'advanced',
    },
    {
      id: 'general.tab4',
      groupId: 'general',
      title: 'Switch to timeline tab 4',
      visibility: 'advanced',
    },
    {
      id: 'general.tab5',
      groupId: 'general',
      title: 'Switch to timeline tab 5',
      visibility: 'advanced',
    },
    {
      id: 'general.tab6',
      groupId: 'general',
      title: 'Switch to timeline tab 6',
      visibility: 'advanced',
    },
    {
      id: 'general.tab7',
      groupId: 'general',
      title: 'Switch to timeline tab 7',
      visibility: 'advanced',
    },
    {
      id: 'general.tab8',
      groupId: 'general',
      title: 'Switch to timeline tab 8',
      visibility: 'advanced',
    },
    {
      id: 'general.tab9',
      groupId: 'general',
      title: 'Switch to timeline tab 9',
      visibility: 'advanced',
    },

    // General - Settings and tasks (rarely used)
    {
      id: 'general.newTimeline',
      groupId: 'general',
      title: 'Create new timeline',
      visibility: 'advanced',
    },
    {
      id: 'general.backgroundTasks',
      groupId: 'general',
      title: 'Show background tasks',
      visibility: 'advanced',
    },
    {
      id: 'general.projectSettings',
      groupId: 'general',
      title: 'Open project settings',
      visibility: 'advanced',
    },
    {
      id: 'general.appSettings',
      groupId: 'general',
      title: 'Open application settings',
      visibility: 'advanced',
    },

    // File Manager
    { id: 'general.navigateBack', groupId: 'fileManager', title: 'Navigate back' },
    {
      id: 'general.navigateForward',
      groupId: 'fileManager',
      title: 'Navigate forward',
    },
    { id: 'general.navigateUp', groupId: 'fileManager', title: 'Navigate up' },
    { id: 'general.createFolder', groupId: 'fileManager', title: 'Create folder' },

    // Transport & navigation - Playback
    {
      id: 'playback.toggle',
      groupId: 'timelineMonitorGlobal',
      title: 'Toggle playback (current speed)',
    },
    {
      id: 'playback.toggle1',
      groupId: 'timelineMonitorGlobal',
      title: 'Toggle playback (1x)',
    },
    {
      id: 'playback.play1ResetSpeed',
      groupId: 'timelineMonitorGlobal',
      title: 'Play 1x / reset speed',
      visibility: 'advanced',
    },
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

    // Transport & navigation - Volume
    { id: 'general.mute', groupId: 'timelineMonitorGlobal', title: 'Mute / Unmute' },
    { id: 'general.volumeUp', groupId: 'timelineMonitorGlobal', title: 'Increase monitor volume' },
    {
      id: 'general.volumeDown',
      groupId: 'timelineMonitorGlobal',
      title: 'Decrease monitor volume',
    },

    // Transport & navigation - Markers
    { id: 'general.addMarker', groupId: 'timelineMonitorGlobal', title: 'Add marker' },
    { id: 'general.prevMarker', groupId: 'timelineMonitorGlobal', title: 'Previous marker' },
    { id: 'general.nextMarker', groupId: 'timelineMonitorGlobal', title: 'Next marker' },

    // Transport & navigation - Selection/Boundaries
    {
      id: 'timeline.setSelectionIn',
      groupId: 'timelineMonitorGlobal',
      title: 'Set selection In',
      visibility: 'advanced',
    },
    {
      id: 'timeline.setSelectionOut',
      groupId: 'timelineMonitorGlobal',
      title: 'Set selection Out',
      visibility: 'advanced',
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
      visibility: 'advanced',
    },
    {
      id: 'playback.jumpNextBoundaryTrack',
      groupId: 'timelineMonitorGlobal',
      title: 'Jump to next edit point on track',
      visibility: 'advanced',
    },

    // Transport & navigation - Snapshot
    {
      id: 'general.snapshot',
      groupId: 'timelineMonitorGlobal',
      title: 'Create snapshot from monitor',
      visibility: 'advanced',
    },
    {
      id: 'monitor.center',
      groupId: 'monitor',
      title: 'Center monitor view',
      visibility: 'advanced',
    },

    // Transport & navigation - Frame-by-frame navigation and speed loops
    { id: 'playback.stepForward', groupId: 'timelineMonitorGlobal', title: 'Step forward' },
    { id: 'playback.stepBackward', groupId: 'timelineMonitorGlobal', title: 'Step backward' },
    {
      id: 'playback.stepForwardLarge',
      groupId: 'timelineMonitorGlobal',
      title: 'Step forward (large)',
    },
    {
      id: 'playback.stepBackwardLarge',
      groupId: 'timelineMonitorGlobal',
      title: 'Step backward (large)',
    },
    {
      id: 'playback.speedUpForward',
      groupId: 'timelineMonitorGlobal',
      title: 'Speed up (forward)',
      visibility: 'advanced',
    },
    {
      id: 'playback.speedDown',
      groupId: 'timelineMonitorGlobal',
      title: 'Slow down',
      visibility: 'advanced',
    },

    // Transport & navigation - Classic J/K/L shuttle (unbound by default)
    {
      id: 'playback.shuttleReverse',
      groupId: 'timelineMonitorGlobal',
      title: 'Shuttle reverse',
    },
    { id: 'playback.shuttleStop', groupId: 'timelineMonitorGlobal', title: 'Shuttle stop' },
    {
      id: 'playback.shuttleForward',
      groupId: 'timelineMonitorGlobal',
      title: 'Shuttle forward',
    },

    // Timeline - Splitting (most frequent)
    { id: 'timeline.splitAtPlayhead', groupId: 'timeline', title: 'Split at playhead' },
    { id: 'timeline.splitAllAtPlayhead', groupId: 'timeline', title: 'Split all at playhead' },

    // Timeline - Clip edge trim (simple)
    {
      id: 'timeline.trimToPlayheadLeft',
      groupId: 'timeline',
      title: 'Trim clip start to playhead',
    },
    { id: 'timeline.trimToPlayheadRight', groupId: 'timeline', title: 'Trim clip end to playhead' },

    // Timeline - Trim with shift (ripple)
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

    // Timeline - Cut out timeline
    { id: 'timeline.rippleDelete', groupId: 'timeline', title: 'Ripple delete' },
    {
      id: 'timeline.rippleDeleteSelectedClipRange',
      groupId: 'timeline',
      title: 'Ripple delete selected clip range on all tracks',
    },

    // Timeline - Selection
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

    // Timeline - Moving
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

    // Timeline - Clip parameters
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

    // Timeline - Snapping and drag modes
    {
      id: 'timeline.selectSnapModeSnap',
      groupId: 'timeline',
      title: 'Switch to clip snapping',
      visibility: 'advanced',
    },
    {
      id: 'timeline.selectSnapModeNoSnap',
      groupId: 'timeline',
      title: 'Switch to no snapping',
      visibility: 'advanced',
    },
    {
      id: 'timeline.selectSnapModeFree',
      groupId: 'timeline',
      title: 'Toggle free audio placement',
      visibility: 'advanced',
    },
    {
      id: 'timeline.selectDragModeMove',
      groupId: 'timeline',
      title: 'Switch to normal move mode',
      visibility: 'advanced',
    },
    {
      id: 'timeline.selectDragModePseudoOverlap',
      groupId: 'timeline',
      title: 'Switch to pseudo-overlap mode',
      visibility: 'advanced',
    },
    {
      id: 'timeline.selectDragModeSlip',
      groupId: 'timeline',
      title: 'Switch to slip mode',
      visibility: 'advanced',
    },

    // Timeline - Clip toggles
    { id: 'timeline.toggleDisableClip', groupId: 'timeline', title: 'Disable / Enable clip' },
    { id: 'timeline.toggleMuteClip', groupId: 'timeline', title: 'Mute / Unmute clip' },
    {
      id: 'timeline.toggleLockClip',
      groupId: 'timeline',
      title: 'Toggle lock clip',
      visibility: 'advanced',
    },
    {
      id: 'timeline.toggleFreezeFrame',
      groupId: 'timeline',
      title: 'Toggle clip freeze frame',
      visibility: 'advanced',
    },

    // Timeline - Track toggles
    {
      id: 'timeline.toggleVisibilityTrack',
      groupId: 'timeline',
      title: 'Hide / Show video track',
      visibility: 'advanced',
    },
    {
      id: 'timeline.toggleMuteTrack',
      groupId: 'timeline',
      title: 'Mute / Unmute audio track',
      visibility: 'advanced',
    },
    {
      id: 'timeline.toggleSoloTrack',
      groupId: 'timeline',
      title: 'Solo / Unsolo audio track',
      visibility: 'advanced',
    },
    {
      id: 'timeline.toggleLockTrack',
      groupId: 'timeline',
      title: 'Toggle lock track',
      visibility: 'advanced',
    },

    // Timeline - Waveform and thumbnails
    {
      id: 'timeline.toggleWaveformMode',
      groupId: 'timeline',
      title: 'Toggle clip waveform mode',
      visibility: 'advanced',
    },
    {
      id: 'timeline.toggleShowWaveform',
      groupId: 'timeline',
      title: 'Toggle show clip waveform',
      visibility: 'advanced',
    },
    {
      id: 'timeline.toggleShowThumbnails',
      groupId: 'timeline',
      title: 'Toggle show clip thumbnails',
      visibility: 'advanced',
    },

    // Timeline - Clip volume
    {
      id: 'timeline.increaseSelectedClipsVolume',
      groupId: 'timeline',
      title: 'Increase selected clips volume',
      visibility: 'advanced',
    },
    {
      id: 'timeline.decreaseSelectedClipsVolume',
      groupId: 'timeline',
      title: 'Decrease selected clips volume',
      visibility: 'advanced',
    },
    {
      id: 'timeline.increaseSelectedClipsVolumeLarge',
      groupId: 'timeline',
      title: 'Increase selected clips volume (large step)',
      visibility: 'advanced',
    },
    {
      id: 'timeline.decreaseSelectedClipsVolumeLarge',
      groupId: 'timeline',
      title: 'Decrease selected clips volume (large step)',
      visibility: 'advanced',
    },

    // Timeline - Create clips
    {
      id: 'timeline.addTextClipAtPlayhead',
      groupId: 'timeline',
      title: 'Create text clip at playhead',
      visibility: 'advanced',
    },
    {
      id: 'timeline.addBackgroundClipAtPlayhead',
      groupId: 'timeline',
      title: 'Create background clip at playhead',
      visibility: 'advanced',
    },
    {
      id: 'timeline.addAdjustmentClipAtPlayhead',
      groupId: 'timeline',
      title: 'Create adjustment clip at playhead',
      visibility: 'advanced',
    },

    // Timeline - Other
    { id: 'timeline.duplicate', groupId: 'timeline', title: 'Duplicate timeline / Create version' },
    { id: 'timeline.centerPlayhead', groupId: 'timeline', title: 'Center playhead' },
    { id: 'timeline.toggleBladeTool', groupId: 'timeline', title: 'Toggle blade tool' },
    { id: 'timeline.reverseSpeed', groupId: 'timeline', title: 'Reverse speed' },
    { id: 'timeline.openSpeedModal', groupId: 'timeline', title: 'Open speed modal' },
    { id: 'timeline.groupClips', groupId: 'timeline', title: 'Group clips' },
    { id: 'timeline.ungroupClips', groupId: 'timeline', title: 'Ungroup clips' },

    // Monitor - Playback speeds (ascending)
    {
      id: 'playback.forward0_5',
      groupId: 'monitor',
      title: 'Forward 0.5x',
      visibility: 'advanced',
    },
    {
      id: 'playback.backward0_5',
      groupId: 'monitor',
      title: 'Backward 0.5x',
      visibility: 'advanced',
    },
    {
      id: 'playback.forward0_75',
      groupId: 'monitor',
      title: 'Forward 0.75x',
      visibility: 'advanced',
    },
    {
      id: 'playback.backward0_75',
      groupId: 'monitor',
      title: 'Backward 0.75x',
      visibility: 'advanced',
    },
    {
      id: 'playback.forward1_25',
      groupId: 'monitor',
      title: 'Forward 1.25x',
      visibility: 'advanced',
    },
    {
      id: 'playback.backward1_25',
      groupId: 'monitor',
      title: 'Backward 1.25x',
      visibility: 'advanced',
    },
    {
      id: 'playback.forward1_5',
      groupId: 'monitor',
      title: 'Forward 1.5x',
      visibility: 'advanced',
    },
    {
      id: 'playback.backward1_5',
      groupId: 'monitor',
      title: 'Backward 1.5x',
      visibility: 'advanced',
    },
    {
      id: 'playback.forward1_75',
      groupId: 'monitor',
      title: 'Forward 1.75x',
      visibility: 'advanced',
    },
    {
      id: 'playback.backward1_75',
      groupId: 'monitor',
      title: 'Backward 1.75x',
      visibility: 'advanced',
    },
    { id: 'playback.forward2', groupId: 'monitor', title: 'Forward 2x', visibility: 'advanced' },
    { id: 'playback.backward2', groupId: 'monitor', title: 'Backward 2x', visibility: 'advanced' },
    { id: 'playback.forward3', groupId: 'monitor', title: 'Forward 3x', visibility: 'advanced' },
    { id: 'playback.backward3', groupId: 'monitor', title: 'Backward 3x', visibility: 'advanced' },
    { id: 'playback.forward5', groupId: 'monitor', title: 'Forward 5x', visibility: 'advanced' },
    { id: 'playback.backward5', groupId: 'monitor', title: 'Backward 5x', visibility: 'advanced' },
  ],
  bindings: {
    'general.copy': [`${Modifier2}+C`],
    'general.cut': [`${Modifier2}+X`],
    'general.paste': [`${Modifier2}+V`],
    'general.undo': [`${Modifier2}+Z`],
    'general.redo': [`${Modifier2}+Y`, `${Modifier2}+${Modifier1}+Z`],
    'general.delete': ['Delete', 'X'],
    'general.selectAll': [`${Modifier2}+A`],
    'general.deselect': ['Escape'],

    'general.focus': ['Tab'],
    'general.rename': ['F2'],
    'general.save': [`${Modifier2}+S`],
    'general.newTimeline': [`${Modifier1}+N`],

    'general.mute': [`${Modifier2}+Q`],
    'general.volumeUp': [`${Modifier1}+=`],
    'general.volumeDown': [`${Modifier1}+-`],
    'general.snapshot': [`${Modifier2}+H`],
    'monitor.center': [],
    'general.fullscreen': ['`'],

    'general.zoomIn': ['='],
    'general.zoomOut': ['-'],
    'general.zoomReset': ['0'],
    'general.zoomFit': [`${Modifier1}+0`],

    'general.addMarker': ['M'],
    'general.prevMarker': ['['],
    'general.nextMarker': [']'],

    'general.switchViewFiles': ['1'],
    'general.switchViewCut': ['2'],
    'general.switchViewEffects': ['3'],
    'general.switchViewSound': ['4'],
    'general.switchViewExport': ['5'],
    'general.projectTabFiles': [`${Modifier1}+H`],
    'general.projectTabHistory': [`${Modifier1}+J`],
    'general.projectTabEffects': [`${Modifier1}+K`],
    'general.projectTabLibrary': [`${Modifier1}+L`],
    'general.projectTabMarkers': [`${Modifier1}+;`],
    'general.projectTabBackups': [`${Modifier1}+'`],
    'general.backgroundTasks': [`${Modifier1}+Y`],
    'general.projectSettings': [`${Modifier1}+U`],
    'general.appSettings': [`${Modifier1}+I`],

    'general.tab1': [`${Modifier1}+1`],
    'general.tab2': [`${Modifier1}+2`],
    'general.tab3': [`${Modifier1}+3`],
    'general.tab4': [`${Modifier1}+4`],
    'general.tab5': [`${Modifier1}+5`],
    'general.tab6': [`${Modifier1}+6`],
    'general.tab7': [`${Modifier1}+7`],
    'general.tab8': [`${Modifier1}+8`],
    'general.tab9': [`${Modifier1}+9`],

    'timeline.duplicate': [`${Modifier2}+${Modifier1}+S`],
    'general.navigateBack': [],
    'general.navigateForward': [],
    'general.navigateUp': [`${Modifier2}+ArrowUp`],
    'general.createFolder': [`${Modifier2}+\\`],

    'timeline.addTextClipAtPlayhead': ['N'],
    'timeline.addBackgroundClipAtPlayhead': ['U'],
    'timeline.addAdjustmentClipAtPlayhead': ['Y'],
    'timeline.selectSnapModeSnap': ['H'],
    'timeline.selectSnapModeNoSnap': ['J'],
    'timeline.selectSnapModeFree': ['K'],
    'timeline.selectDragModeMove': ['L'],
    'timeline.selectDragModePseudoOverlap': [';'],
    'timeline.selectDragModeSlip': ["'"],
    'timeline.selectClipsLeftOfPlayhead': [`${Modifier1}+D`],
    'timeline.selectClipsRightOfPlayhead': [`${Modifier1}+F`],
    'timeline.trimToPlayheadLeft': ['C'],
    'timeline.trimToPlayheadRight': ['V'],
    'timeline.rippleTrimLeft': [`${Modifier1}+E`],
    'timeline.rippleTrimRight': [`${Modifier1}+R`],
    'timeline.advancedRippleTrimLeft': ['E'],
    'timeline.advancedRippleTrimRight': ['R'],
    'timeline.rippleDeleteSelectedClipRange': ['Z'],
    'timeline.rippleDelete': [`${Modifier1}+Z`, 'Backspace'],
    'timeline.splitAtPlayhead': ['T'],
    'timeline.splitAllAtPlayhead': [`${Modifier1}+T`],
    'timeline.toggleDisableClip': ['W'],
    'timeline.toggleMuteClip': ['Q'],
    'timeline.toggleVisibilityTrack': [`${Modifier1}+W`],
    'timeline.toggleMuteTrack': [`${Modifier1}+Q`],
    'timeline.toggleSoloTrack': [`${Modifier1}+S`],
    'timeline.moveSelectedClipsLeft': [`${Modifier2}+ArrowLeft`],
    'timeline.moveSelectedClipsRight': [`${Modifier2}+ArrowRight`],
    'timeline.moveSelectedClipsLeftLarge': [`${Modifier2}+${Modifier1}+ArrowLeft`],
    'timeline.moveSelectedClipsRightLarge': [`${Modifier2}+${Modifier1}+ArrowRight`],
    'timeline.increaseSelectedClipsVolume': [`${Modifier2}+ArrowUp`],
    'timeline.decreaseSelectedClipsVolume': [`${Modifier2}+ArrowDown`],
    'timeline.increaseSelectedClipsVolumeLarge': [`${Modifier2}+${Modifier1}+ArrowUp`],
    'timeline.decreaseSelectedClipsVolumeLarge': [`${Modifier2}+${Modifier1}+ArrowDown`],
    'timeline.copyClipParameters': [`${Modifier1}+C`],
    'timeline.pasteClipParameters': [`${Modifier1}+V`],
    'timeline.toggleWaveformMode': [','],
    'timeline.toggleShowWaveform': ['.'],
    'timeline.toggleShowThumbnails': [`${Modifier1}+X`],
    'timeline.toggleFreezeFrame': [`${Modifier1}+B`],
    'timeline.toggleLockClip': ['B'],
    'timeline.toggleLockTrack': [],
    'timeline.setSelectionIn': ['I'],
    'timeline.setSelectionOut': ['O'],
    'timeline.centerPlayhead': [`${Modifier1}+/`],
    'timeline.toggleBladeTool': ['/'],
    'timeline.reverseSpeed': ['P'],
    'timeline.openSpeedModal': [`${Modifier2}+P`],
    'timeline.groupClips': [`${Modifier2}+G`],
    'timeline.ungroupClips': [`${Modifier2}+${Modifier1}+G`],

    'playback.toggle': [`${Modifier1}+Space`],
    'playback.toggle1': ['Space'],
    'playback.play1ResetSpeed': [],
    'timeline.globalToStart': ['Home', `${Modifier2}+E`],
    'timeline.globalToEnd': ['End', `${Modifier2}+R`],
    'playback.stepForward': ['ArrowRight'],
    'playback.stepBackward': ['ArrowLeft'],
    'playback.stepForwardLarge': [`${Modifier1}+ArrowRight`],
    'playback.stepBackwardLarge': [`${Modifier1}+ArrowLeft`],
    'playback.forward1_25': [],
    'playback.backward1_25': [],
    'playback.forward1_5': [],
    'playback.backward1_5': [],
    'playback.speedUpForward': [],
    'playback.speedDown': [],
    'playback.forward1_75': [],
    'playback.backward1_75': [],
    'playback.forward2': [],
    'playback.backward2': [],
    'playback.forward3': [],
    'playback.backward3': [],
    'playback.forward5': [],
    'playback.backward5': [],
    'playback.forward0_75': [],
    'playback.backward0_75': [],
    'playback.forward0_5': [],
    'playback.backward0_5': [],
    'playback.shuttleReverse': ['S'],
    'playback.shuttleStop': ['D'],
    'playback.shuttleForward': ['F'],
    'playback.jumpPrevBoundary': ['A', 'ArrowUp'],
    'playback.jumpNextBoundary': ['G', 'ArrowDown'],
    'playback.jumpPrevBoundaryTrack': [`${Modifier1}+A`, `${Modifier1}+ArrowUp`],
    'playback.jumpNextBoundaryTrack': [`${Modifier1}+G`, `${Modifier1}+ArrowDown`],
  },
};
