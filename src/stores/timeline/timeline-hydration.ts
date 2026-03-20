import type { Ref } from 'vue';

import type { TimelineDocument } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';

export interface TimelineHydrationDeps {
  mediaMetadata: Ref<Record<string, { duration: number; video?: unknown; audio?: unknown }>>;
}

export interface TimelineHydrationApi {
  hydrateClipSourceDuration: (doc: TimelineDocument, cmd: TimelineCommand) => TimelineDocument;
}

export function createTimelineHydration(deps: TimelineHydrationDeps): TimelineHydrationApi {
  function hydrateClipSourceDuration(
    doc: TimelineDocument,
    cmd: TimelineCommand,
  ): TimelineDocument {
    if (cmd.type !== 'trim_item' && cmd.type !== 'overlay_trim_item') return doc;

    const track = doc.tracks.find((t) => t.id === cmd.trackId);
    if (!track) return doc;

    const item = track.items.find((it) => it.id === cmd.itemId);
    if (!item) return doc;
    if (item.kind !== 'clip') return doc;
    if (item.clipType !== 'media') return doc;
    if (!item.source?.path) return doc;

    const meta = deps.mediaMetadata.value[item.source.path];
    if (!meta) return doc;

    const hasVideo = Boolean(meta.video);
    const hasAudio = Boolean(meta.audio);
    const isImageLike = !hasVideo && !hasAudio;

    const durationS = Number(meta.duration);
    const durationUs =
      Number.isFinite(durationS) && durationS > 0 ? Math.floor(durationS * 1_000_000) : 0;

    const needsSourceDurationPatch = durationUs > 0 && item.sourceDurationUs !== durationUs;
    const needsIsImagePatch = isImageLike && !item.isImage;

    if (!needsSourceDurationPatch && !needsIsImagePatch) return doc;

    const nextTracks = doc.tracks.map((t) =>
      t.id !== track.id
        ? t
        : {
            ...t,
            items: t.items.map((it) => {
              if (it.id === item.id && it.kind === 'clip' && it.clipType === 'media') {
                const patch: { sourceDurationUs?: number; isImage?: boolean } = {};
                if (needsSourceDurationPatch) patch.sourceDurationUs = durationUs;
                if (needsIsImagePatch) patch.isImage = true;
                return { ...it, ...patch };
              }
              return it;
            }),
          },
    );

    return { ...doc, tracks: nextTracks };
  }

  return {
    hydrateClipSourceDuration,
  };
}
