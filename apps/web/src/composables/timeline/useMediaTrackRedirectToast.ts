import { useTimelineStore } from '~/stores/timeline.store';

/**
 * Mobile add-media flows route a clip to a track matching its media type (audio → audio,
 * video/image → video), regardless of which track the user had selected. That routing is the
 * expected behaviour, but it can be confusing when the clip lands somewhere other than the
 * selected track. This emits a single non-blocking toast explaining the redirect.
 */
export function useMediaTrackRedirectToast() {
  const timelineStore = useTimelineStore();
  const toast = useToast();
  const { t } = useI18n();

  /**
   * Capture the user's selection kind before adding clips, since adding may change the
   * selection (e.g. by selecting the newly inserted clip).
   */
  function captureSelectionKind(): 'video' | 'audio' | null {
    return timelineStore.getMobileSelectionKind();
  }

  /**
   * Show the toast when at least one added clip was routed to a different track kind than the
   * one the user had selected. No-op when nothing was redirected or when no track was selected.
   */
  function notifyRedirect(
    selectionKind: 'video' | 'audio' | null,
    addedKinds: ('video' | 'audio')[],
  ): void {
    if (!selectionKind) return;

    const redirected = addedKinds.find((kind) => kind !== selectionKind);
    if (!redirected) return;

    toast.add({
      title: t('videoEditor.timeline.clipAddedToCompatibleTrack', {
        kind: t(
          redirected === 'audio'
            ? 'videoEditor.timeline.trackKindAudio'
            : 'videoEditor.timeline.trackKindVideo',
        ),
      }),
      color: 'info',
    });
  }

  return { captureSelectionKind, notifyRedirect };
}
