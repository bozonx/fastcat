import type { TimelineDocument } from './types';
import { extractAudioToTrack, returnAudioToVideo } from './commands/audioHandlers';
import { addTrack, renameTrack, deleteTrack, reorderTracks } from './commands/trackHandlers';
import {
  addClipToTrack,
  renameItem,
  removeItems,
  moveItem,
  moveItemToTrack,
  trimItem,
  updateClipProperties,
} from './commands/itemHandlers';

export interface AddClipToTrackCommand {
  type: 'add_clip_to_track';
  trackId: string;
  name: string;
  path: string;
  durationUs?: number;
  sourceDurationUs?: number;
  startUs?: number;
}

export interface RemoveItemCommand {
  type: 'remove_item';
  trackId: string;
  itemId: string;
}

export interface MoveItemCommand {
  type: 'move_item';
  trackId: string;
  itemId: string;
  startUs: number;
}

export interface TrimItemCommand {
  type: 'trim_item';
  trackId: string;
  itemId: string;
  edge: 'start' | 'end';
  deltaUs: number;
}

export interface DeleteItemsCommand {
  type: 'delete_items';
  trackId: string;
  itemIds: string[];
}

export interface AddTrackCommand {
  type: 'add_track';
  kind: 'video' | 'audio';
  name: string;
  trackId?: string;
}

export interface RenameTrackCommand {
  type: 'rename_track';
  trackId: string;
  name: string;
}

export interface DeleteTrackCommand {
  type: 'delete_track';
  trackId: string;
  allowNonEmpty?: boolean;
}

export interface ReorderTracksCommand {
  type: 'reorder_tracks';
  trackIds: string[];
}

export interface MoveItemToTrackCommand {
  type: 'move_item_to_track';
  fromTrackId: string;
  toTrackId: string;
  itemId: string;
  startUs: number;
}

export interface ExtractAudioToTrackCommand {
  type: 'extract_audio_to_track';
  videoTrackId: string;
  videoItemId: string;
  audioTrackId: string;
}

export interface ReturnAudioToVideoCommand {
  type: 'return_audio_to_video';
  videoItemId: string;
}

export interface RenameItemCommand {
  type: 'rename_item';
  trackId: string;
  itemId: string;
  name: string;
}

export interface UpdateClipPropertiesCommand {
  type: 'update_clip_properties';
  trackId: string;
  itemId: string;
  properties: Partial<Pick<import('./types').TimelineClipItem, 'opacity' | 'effects'>>;
}

export type TimelineCommand =
  | AddClipToTrackCommand
  | RemoveItemCommand
  | MoveItemCommand
  | TrimItemCommand
  | DeleteItemsCommand
  | AddTrackCommand
  | RenameTrackCommand
  | DeleteTrackCommand
  | ReorderTracksCommand
  | MoveItemToTrackCommand
  | ExtractAudioToTrackCommand
  | ReturnAudioToVideoCommand
  | RenameItemCommand
  | UpdateClipPropertiesCommand;

export interface TimelineCommandResult {
  next: TimelineDocument;
}

export function applyTimelineCommand(
  doc: TimelineDocument,
  cmd: TimelineCommand,
): TimelineCommandResult {
  switch (cmd.type) {
    case 'extract_audio_to_track':
      return extractAudioToTrack(doc, cmd);
    case 'return_audio_to_video':
      return returnAudioToVideo(doc, cmd);
    case 'add_track':
      return addTrack(doc, cmd);
    case 'rename_track':
      return renameTrack(doc, cmd);
    case 'delete_track':
      return deleteTrack(doc, cmd);
    case 'reorder_tracks':
      return reorderTracks(doc, cmd);
    case 'add_clip_to_track':
      return addClipToTrack(doc, cmd);
    case 'rename_item':
      return renameItem(doc, cmd);
    case 'remove_item':
    case 'delete_items':
      return removeItems(doc, cmd);
    case 'move_item':
      return moveItem(doc, cmd);
    case 'move_item_to_track':
      return moveItemToTrack(doc, cmd);
    case 'trim_item':
      return trimItem(doc, cmd);
    case 'update_clip_properties':
      return updateClipProperties(doc, cmd);
    default:
      return { next: doc };
  }
}
