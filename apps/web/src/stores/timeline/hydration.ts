import { TICKS_PER_SECOND } from '~/utils/time';
import type { Ref } from 'vue';

import type { TimelineDocument } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';

export interface TimelineHydrationDeps {
  mediaMetadata: Ref<Record<string, { duration: number; video?: unknown; audio?: unknown }>>;
}

export interface TimelineHydrationModule {
  hydrateClipSourceDuration: (doc: TimelineDocument, cmd: TimelineCommand) => TimelineDocument;
  hydrateAllClips: (doc: TimelineDocument) => TimelineDocument;
}

export function createTimelineHydrationModule(
  deps: TimelineHydrationDeps,
): TimelineHydrationModule {
  function hydrateAllClips(doc: TimelineDocument): TimelineDocument {
    // Fast path: scan once without allocating arrays to see if any work is needed.
    let anyPatch = false;
    for (const t of doc.tracks) {
      for (const it of t.items) {
        if (it.kind === 'clip' && it.clipType === 'media' && it.source?.path) {
          const meta = deps.mediaMetadata.value[it.source.path];
          if (meta) {
            const durationS = Number(meta.duration);
            const durationTicks =
              Number.isFinite(durationS) && durationS > 0
                ? Math.floor(durationS * TICKS_PER_SECOND)
                : 0;
            const isImageLike = !meta.video && !meta.audio;
            if (
              (durationTicks > 0 && it.sourceDurationTicks !== durationTicks) ||
              it.isImage !== isImageLike
            ) {
              anyPatch = true;
              break;
            }
          }
        }
      }
      if (anyPatch) break;
    }
    if (!anyPatch) return doc;

    let changed = false;
    const nextTracks = doc.tracks.map((t) => {
      let trackChanged = false;
      const nextItems = t.items.map((it) => {
        if (it.kind === 'clip' && it.clipType === 'media' && it.source?.path) {
          const meta = deps.mediaMetadata.value[it.source.path];
          if (meta) {
            const durationS = Number(meta.duration);
            const durationTicks =
              Number.isFinite(durationS) && durationS > 0
                ? Math.floor(durationS * TICKS_PER_SECOND)
                : 0;
            const isImageLike = !meta.video && !meta.audio;

            const needsSourceDurationPatch =
              durationTicks > 0 && it.sourceDurationTicks !== durationTicks;
            const needsIsImagePatch = it.isImage !== isImageLike;
            if (needsSourceDurationPatch || needsIsImagePatch) {
              trackChanged = true;
              return {
                ...it,
                ...(needsSourceDurationPatch ? { sourceDurationTicks: durationTicks } : {}),
                ...(needsIsImagePatch ? { isImage: isImageLike } : {}),
              };
            }
          }
        }
        return it;
      });

      if (trackChanged) {
        changed = true;
        return { ...t, items: nextItems };
      }
      return t;
    });

    return changed ? { ...doc, tracks: nextTracks } : doc;
  }

  function hydrateClipSourceDuration(
    doc: TimelineDocument,
    cmd: TimelineCommand,
  ): TimelineDocument {
    if (
      cmd.type !== 'trim_item' &&
      cmd.type !== 'overlay_trim_item' &&
      cmd.type !== 'update_clip_properties' &&
      cmd.type !== 'move_item' &&
      cmd.type !== 'move_item_to_track' &&
      cmd.type !== 'overlay_place_item'
    )
      return doc;

    const trackId = 'trackId' in cmd ? cmd.trackId : 'fromTrackId' in cmd ? cmd.fromTrackId : null;
    const itemId = 'itemId' in cmd ? cmd.itemId : null;

    if (!trackId || !itemId) return doc;

    const track = doc.tracks.find((t) => t.id === trackId);
    if (!track) return doc;

    const item = track.items.find((it) => it.id === itemId);
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
    const durationTicks =
      Number.isFinite(durationS) && durationS > 0 ? Math.floor(durationS * TICKS_PER_SECOND) : 0;

    const needsSourceDurationPatch =
      durationTicks > 0 && item.sourceDurationTicks !== durationTicks;
    const needsIsImagePatch = item.isImage !== isImageLike;

    if (!needsSourceDurationPatch && !needsIsImagePatch) return doc;

    const nextTracks = doc.tracks.map((t) =>
      t.id !== track.id
        ? t
        : {
            ...t,
            items: t.items.map((it) => {
              if (it.id === item.id && it.kind === 'clip' && it.clipType === 'media') {
                const patch: { sourceDurationTicks?: number; isImage?: boolean } = {};
                if (needsSourceDurationPatch) patch.sourceDurationTicks = durationTicks;
                if (needsIsImagePatch) patch.isImage = isImageLike;
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
    hydrateAllClips,
  };
}
