/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  TIMELINE_COMMAND_LABEL_KEYS,
  TIMELINE_MULTIPLE_ACTIONS_LABEL_KEY,
  getUpdateClipPropertiesLabelKey,
  getTimelineCommandLabelKey,
} from '~/stores/timeline/history-labels';

describe('history-labels', () => {
  describe('TIMELINE_COMMAND_LABEL_KEYS', () => {
    it('has a label key for every command type', () => {
      const commandTypes = [
        'add_clip_to_track',
        'add_virtual_clip_to_track',
        'remove_item',
        'delete_items',
        'move_item',
        'move_items',
        'move_item_to_track',
        'trim_item',
        'trim_items',
        'overlay_trim_item',
        'overlay_place_item',
        'split_item',
        'rename_item',
        'update_clip_properties',
        'update_clip_transition',
        'add_marker',
        'update_marker',
        'remove_marker',
        'add_track',
        'rename_track',
        'delete_track',
        'reorder_tracks',
        'update_track_properties',
        'extract_audio_to_track',
        'update_master_gain',
        'update_master_muted',
        'update_master_effects',
        'update_timeline_properties',
        'auto_trim_pauses',
      ];
      for (const type of commandTypes) {
        expect(TIMELINE_COMMAND_LABEL_KEYS[type as keyof typeof TIMELINE_COMMAND_LABEL_KEYS]).toBeDefined();
      }
    });
  });

  describe('getTimelineCommandLabelKey', () => {
    it('returns the mapped label key for known command types', () => {
      expect(getTimelineCommandLabelKey('add_clip_to_track')).toBe(
        'videoEditor.fileManager.history.entries.addClip',
      );
      expect(getTimelineCommandLabelKey('split_item')).toBe(
        'videoEditor.fileManager.history.entries.splitClip',
      );
    });

    it('returns a fallback key for unknown command types', () => {
      const result = getTimelineCommandLabelKey('unknown_command' as never);
      expect(result).toBe('videoEditor.fileManager.history.entries.unknown_command');
    });
  });

  describe('getUpdateClipPropertiesLabelKey', () => {
    it('returns specific label for single known property', () => {
      expect(getUpdateClipPropertiesLabelKey({ audioGain: 1.5 })).toBe(
        'videoEditor.fileManager.history.entries.updateClipGain',
      );
      expect(getUpdateClipPropertiesLabelKey({ audioMuted: true })).toBe(
        'videoEditor.fileManager.history.entries.toggleMute',
      );
      expect(getUpdateClipPropertiesLabelKey({ locked: true })).toBe(
        'videoEditor.fileManager.history.entries.toggleLock',
      );
      expect(getUpdateClipPropertiesLabelKey({ opacity: 0.5 })).toBe(
        'videoEditor.fileManager.history.entries.updateClipOpacity',
      );
      expect(getUpdateClipPropertiesLabelKey({ speed: 2.0 })).toBe(
        'videoEditor.fileManager.history.entries.updateClipSpeed',
      );
      expect(getUpdateClipPropertiesLabelKey({ transform: {} })).toBe(
        'videoEditor.fileManager.history.entries.updateClipTransform',
      );
    });

    it('returns generic label for multiple properties', () => {
      expect(getUpdateClipPropertiesLabelKey({ audioGain: 1, opacity: 0.5 })).toBe(
        'videoEditor.fileManager.history.entries.updateClipProperties',
      );
    });

    it('returns generic label for unknown single property', () => {
      expect(getUpdateClipPropertiesLabelKey({ unknownProp: true })).toBe(
        'videoEditor.fileManager.history.entries.updateClipProperties',
      );
    });

    it('returns generic label for empty properties', () => {
      expect(getUpdateClipPropertiesLabelKey({})).toBe(
        'videoEditor.fileManager.history.entries.updateClipProperties',
      );
    });
  });

  it('TIMELINE_MULTIPLE_ACTIONS_LABEL_KEY is defined', () => {
    expect(TIMELINE_MULTIPLE_ACTIONS_LABEL_KEY).toBe(
      'videoEditor.fileManager.history.entries.multipleActions',
    );
  });
});
