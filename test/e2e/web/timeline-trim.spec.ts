/*
 * Basic desktop-web timeline trim coverage plan.
 *
 * Scope:
 * - Start from `e2eProject`.
 * - Prepare a timeline that already contains one media clip.
 * - Keep each test focused on one trim operation and verify the saved timeline
 *   state after the operation.
 *
 * Scenarios to implement:
 * - Trim the clip end and verify its duration decreases.
 * - Trim the clip start and verify source offset plus duration are updated.
 * - Attempt to trim beyond the minimum duration and verify the UI clamps it.
 * - Reload the editor and verify the trimmed clip persists.
 *
 * Do not cover here:
 * - Split, ripple edit, transitions, captions, or advanced actions hidden by
 *   feature flags.
 * - Playback quality; use editor-playback tests for playback.
 */
