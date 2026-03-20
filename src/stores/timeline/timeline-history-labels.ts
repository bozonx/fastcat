import type { TimelineCommand } from '~/timeline/commands';

export const TIMELINE_COMMAND_LABEL_KEYS: Record<TimelineCommand['type'], string> = {
  add_clip_to_track: 'videoEditor.fileManager.history.entries.addClip',
  add_virtual_clip_to_track: 'videoEditor.fileManager.history.entries.addClip',
  remove_item: 'videoEditor.fileManager.history.entries.removeItem',
  delete_items: 'videoEditor.fileManager.history.entries.deleteItems',
  move_item: 'videoEditor.fileManager.history.entries.moveItem',
  move_items: 'videoEditor.fileManager.history.entries.moveItems',
  move_item_to_track: 'videoEditor.fileManager.history.entries.moveItem',
  trim_item: 'videoEditor.fileManager.history.entries.trimClip',
  overlay_trim_item: 'videoEditor.fileManager.history.entries.trimClip',
  overlay_place_item: 'videoEditor.fileManager.history.entries.placeClip',
  split_item: 'videoEditor.fileManager.history.entries.splitClip',
  rename_item: 'videoEditor.fileManager.history.entries.renameClip',
  update_clip_properties: 'videoEditor.fileManager.history.entries.updateClip',
  update_clip_transition: 'videoEditor.fileManager.history.entries.updateTransition',
  add_marker: 'videoEditor.fileManager.history.entries.addMarker',
  update_marker: 'videoEditor.fileManager.history.entries.updateMarker',
  remove_marker: 'videoEditor.fileManager.history.entries.removeMarker',
  add_track: 'videoEditor.fileManager.history.entries.addTrack',
  rename_track: 'videoEditor.fileManager.history.entries.renameTrack',
  delete_track: 'videoEditor.fileManager.history.entries.deleteTrack',
  reorder_tracks: 'videoEditor.fileManager.history.entries.reorderTracks',
  update_track_properties: 'videoEditor.fileManager.history.entries.updateTrack',
  extract_audio_to_track: 'videoEditor.fileManager.history.entries.extractAudio',
  return_audio_to_video: 'videoEditor.fileManager.history.entries.returnAudio',
  update_master_gain: 'videoEditor.fileManager.history.entries.updateMasterGain',
  update_master_muted: 'videoEditor.fileManager.history.entries.toggleMute',
  update_master_effects: 'videoEditor.fileManager.history.entries.updateEffects',
  update_timeline_properties: 'videoEditor.fileManager.history.entries.updateTimelineProperties',
};

export const TIMELINE_MULTIPLE_ACTIONS_LABEL_KEY =
  'videoEditor.fileManager.history.entries.multipleActions';

export function getTimelineCommandLabelKey(type: TimelineCommand['type']): string {
  return (
    TIMELINE_COMMAND_LABEL_KEYS[type] || 'videoEditor.fileManager.history.entries.multipleActions'
  );
}
