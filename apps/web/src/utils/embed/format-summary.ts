import { isTimelineGeometryUnresolved } from '~/timeline/format';
import type { TimelineFormat } from '~/timeline/types';

/** Where the output format of an embedded session came from. */
export type EmbedFormatSource = 'unresolved' | 'firstClip' | 'projectDefaults' | 'manual';

export interface EmbedFormatSummary {
  width: number;
  height: number;
  fps: number;
  source: EmbedFormatSource;
}

/**
 * What the embed tells the user about the video it will render.
 *
 * `projectDefaults` in a session means the host chose the format at handshake;
 * `unresolved` means nobody did — only images or audio have arrived so far, and
 * the render would silently use the built-in default.
 */
export function summarizeEmbedFormat(format: TimelineFormat): EmbedFormatSummary {
  return {
    width: format.width,
    height: format.height,
    fps: format.fps,
    source: isTimelineGeometryUnresolved(format) ? 'unresolved' : format.settingsSource,
  };
}
