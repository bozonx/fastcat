import type { TimelineDocument, ClipTransition } from './types';
import { extractAudioToTrack, returnAudioToVideo } from './commands/audioHandlers';
import {
  addTrack,
  renameTrack,
  deleteTrack,
  reorderTracks,
  updateTrackProperties,
} from './commands/trackHandlers';
import { addMarker, removeMarker, updateMarker } from './commands/markerHandlers';
import {
  addClipToTrack,
  addVirtualClipToTrack,
  renameItem,
  removeItems,
  moveItem,
  moveItems,
  moveItemToTrack,
  overlayPlaceItem,
  overlayTrimItem,
  trimItem,
  splitItem,
  updateClipProperties,
  updateClipTransition,
} from './commands/itemHandlers';

export interface AddClipToTrackCommand {
  type: 'add_clip_to_track';
  trackId: string;
  clipId?: string;
  name: string;
  path: string;
  startUs: number;
  durationUs: number;
  sourceRange?: import('./types').TimelineRange;
  isImage?: boolean;
  pseudo?: boolean;
  audioFadeInCurve?: import('./types').AudioFadeCurve;
  audioFadeOutCurve?: import('./types').AudioFadeCurve;
}

export interface AddVirtualClipToTrackCommand {
  type: 'add_virtual_clip_to_track';
  trackId: string;
  clipType: Extract<
    import('./types').TimelineClipType,
    'adjustment' | 'background' | 'text' | 'shape' | 'hud'
  >;
  name: string;
  durationUs?: number;
  startUs?: number;
  pseudo?: boolean;
  backgroundColor?: string;
  text?: string;
  style?: import('./types').TextClipStyle;
  shapeType?: import('./types').ShapeType;
  hudType?: import('./types').HudType;
  audioFadeInCurve?: import('./types').AudioFadeCurve;
  audioFadeOutCurve?: import('./types').AudioFadeCurve;
}

export interface RemoveItemCommand {
  type: 'remove_item';
  trackId: string;
  itemId: string;
  ignoreLocks?: boolean;
}

export interface MoveItemCommand {
  type: 'move_item';
  trackId: string;
  itemId: string;
  startUs: number;
  ignoreLocks?: boolean;
  ignoreLinks?: boolean;
  quantizeToFrames?: boolean;
}

export interface TrimItemCommand {
  type: 'trim_item';
  trackId: string;
  itemId: string;
  edge: 'start' | 'end';
  deltaUs: number;
  quantizeToFrames?: boolean;
}

export interface SplitItemCommand {
  type: 'split_item';
  trackId: string;
  itemId: string;
  atUs: number;
  ignoreLocks?: boolean;
  quantizeToFrames?: boolean;
}

export interface DeleteItemsCommand {
  type: 'delete_items';
  trackId: string;
  itemIds: string[];
  ignoreLocks?: boolean;
}

export interface AddTrackCommand {
  type: 'add_track';
  kind: 'video' | 'audio';
  name: string;
  trackId?: string;
  insertBeforeId?: string;
  insertAfterId?: string;
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
  quantizeToFrames?: boolean;
  ignoreLocks?: boolean;
  ignoreLinks?: boolean;
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
  properties: Partial<
    Pick<
      import('./types').TimelineClipItem,
      | 'disabled'
      | 'locked'
      | 'linkedVideoClipId'
      | 'lockToLinkedVideo'
      | 'opacity'
      | 'blendMode'
      | 'effects'
      | 'freezeFrameSourceUs'
      | 'speed'
      | 'transform'
      | 'audioGain'
      | 'audioBalance'
      | 'audioFadeInUs'
      | 'audioFadeOutUs'
      | 'audioFadeInCurve'
      | 'audioFadeOutCurve'
      | 'audioMuted'
      | 'audioWaveformMode'
      | 'showWaveform'
      | 'showThumbnails'
    >
  > & {
    linkedGroupId?: string;
    backgroundColor?: string;
    text?: string;
    style?: import('./types').TextClipStyle;
    shapeType?: import('./types').ShapeType;
    fillColor?: string;
    strokeColor?: string;
    strokeWidth?: number;
    hudType?: import('./types').HudType;
    background?: import('./types').HudMediaParams;
    content?: import('./types').HudMediaParams;
  };
}

export interface UpdateTrackPropertiesCommand {
  type: 'update_track_properties';
  trackId: string;
  properties: Partial<
    Pick<
      import('./types').TimelineTrack,
      | 'videoHidden'
      | 'opacity'
      | 'blendMode'
      | 'audioMuted'
      | 'audioSolo'
      | 'effects'
      | 'audioGain'
      | 'audioBalance'
    >
  >;
}

export interface UpdateClipTransitionCommand {
  type: 'update_clip_transition';
  trackId: string;
  itemId: string;
  transitionIn?: ClipTransition | null;
  transitionOut?: ClipTransition | null;
}

/**
 * Pseudo-overlay placement: moves an item to a new position on the track,
 * cutting or trimming any clips that are in the way, and deleting clips
 * fully covered by the placed item.
 */
export interface OverlayPlaceItemCommand {
  type: 'overlay_place_item';
  fromTrackId: string;
  toTrackId: string;
  itemId: string;
  startUs: number;
  quantizeToFrames?: boolean;
  ignoreLocks?: boolean;
  ignoreLinks?: boolean;
}

/**
 * Pseudo-overlay trim: trims an item and then cuts/trims any clips that overlap
 * with the trimmed item's resulting range.
 */
export interface OverlayTrimItemCommand {
  type: 'overlay_trim_item';
  trackId: string;
  itemId: string;
  edge: 'start' | 'end';
  deltaUs: number;
  quantizeToFrames?: boolean;
}

export interface AddMarkerCommand {
  type: 'add_marker';
  id: string;
  timeUs: number;
  durationUs?: number;
  text?: string;
  color?: string;
}

export interface UpdateMarkerCommand {
  type: 'update_marker';
  id: string;
  timeUs?: number;
  durationUs?: number | null;
  text?: string;
  color?: string;
}

export interface RemoveMarkerCommand {
  type: 'remove_marker';
  id: string;
}

export interface UpdateMasterGainCommand {
  type: 'update_master_gain';
  gain: number;
}

export interface UpdateMasterMutedCommand {
  type: 'update_master_muted';
  muted: boolean;
}

export interface UpdateMasterEffectsCommand {
  type: 'update_master_effects';
  effects: import('./types').ClipEffect[];
}

export interface UpdateTimelinePropertiesCommand {
  type: 'update_timeline_properties';
  properties: Partial<import('./types').TimelineFastCatMetadata>;
}

export interface MoveItemsCommand {
  type: 'move_items';
  moves: {
    fromTrackId: string;
    toTrackId: string;
    itemId: string;
    startUs: number;
  }[];
  quantizeToFrames?: boolean;
  ignoreLocks?: boolean;
  ignoreLinks?: boolean;
}

export type TimelineCommand =
  | AddClipToTrackCommand
  | AddVirtualClipToTrackCommand
  | RemoveItemCommand
  | MoveItemCommand
  | TrimItemCommand
  | SplitItemCommand
  | DeleteItemsCommand
  | AddTrackCommand
  | RenameTrackCommand
  | DeleteTrackCommand
  | ReorderTracksCommand
  | MoveItemToTrackCommand
  | MoveItemsCommand
  | ExtractAudioToTrackCommand
  | ReturnAudioToVideoCommand
  | RenameItemCommand
  | UpdateClipPropertiesCommand
  | UpdateTrackPropertiesCommand
  | UpdateClipTransitionCommand
  | OverlayPlaceItemCommand
  | OverlayTrimItemCommand
  | AddMarkerCommand
  | UpdateMarkerCommand
  | RemoveMarkerCommand
  | UpdateMasterGainCommand
  | UpdateMasterMutedCommand
  | UpdateMasterEffectsCommand
  | UpdateTimelinePropertiesCommand;

export interface TimelineCommandResult {
  next: TimelineDocument;
  createdItemIds?: string[];
}

export function applyTimelineCommand(
  doc: TimelineDocument,
  cmd: TimelineCommand,
): TimelineCommandResult {
  switch (cmd.type) {
    case 'add_marker':
      return addMarker(doc, cmd);
    case 'update_marker':
      return updateMarker(doc, cmd);
    case 'remove_marker':
      return removeMarker(doc, cmd);
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
    case 'add_virtual_clip_to_track':
      return addVirtualClipToTrack(doc, cmd);
    case 'rename_item':
      return renameItem(doc, cmd);
    case 'remove_item':
    case 'delete_items':
      return removeItems(doc, cmd);
    case 'move_item':
      return moveItem(doc, cmd);
    case 'move_items':
      return moveItems(doc, cmd);
    case 'move_item_to_track':
      return moveItemToTrack(doc, cmd);
    case 'trim_item':
      return trimItem(doc, cmd);
    case 'split_item':
      return splitItem(doc, cmd);
    case 'update_clip_properties':
      return updateClipProperties(doc, cmd);
    case 'update_clip_transition':
      return updateClipTransition(doc, cmd);
    case 'update_track_properties':
      return updateTrackProperties(doc, cmd);
    case 'overlay_place_item':
      return overlayPlaceItem(doc, cmd);
    case 'overlay_trim_item':
      return overlayTrimItem(doc, cmd);
    case 'update_master_gain':
      return {
        next: {
          ...doc,
          metadata: {
            ...(doc.metadata ?? {}),
            fastcat: {
              ...(doc.metadata?.fastcat ?? {}),
              masterGain: cmd.gain,
            },
          },
        },
      };
    case 'update_master_muted':
      return {
        next: {
          ...doc,
          metadata: {
            ...(doc.metadata ?? {}),
            fastcat: {
              ...(doc.metadata?.fastcat ?? {}),
              masterMuted: cmd.muted,
            },
          },
        },
      };
    case 'update_master_effects':
      return {
        next: {
          ...doc,
          metadata: {
            ...(doc.metadata ?? {}),
            fastcat: {
              ...(doc.metadata?.fastcat ?? {}),
              masterEffects: cmd.effects,
            },
          },
        },
      };
    case 'update_timeline_properties':
      return {
        next: {
          ...doc,
          metadata: {
            ...(doc.metadata ?? {}),
            fastcat: {
              ...(doc.metadata?.fastcat ?? {}),
              ...(cmd.properties ?? {}),
            },
          },
        },
      };
    default: {
      const _exhaustiveCheck: never = cmd;
      throw new Error(`Unhandled timeline command type: ${(_exhaustiveCheck as any).type}`);
    }
  }
}
