/*
 * Basic desktop-web timeline add-clip coverage plan.
 *
 * Scope:
 * - Start from `e2eProject`.
 * - Prepare required media with a helper that imports or writes a known fixture
 *   into the project before the timeline action.
 * - Assert timeline state through stable UI locators and, where useful, the
 *   saved OTIO document in OPFS.
 *
 * Scenarios to implement:
 * - Add a video file from the project file manager to the first video track.
 * - Add an audio file from the project file manager to the first audio track.
 * - Add an image file as a still clip.
 * - Verify the clip remains on the timeline after page reload.
 * - Verify the properties panel reflects the selected clip.
 *
 * Do not cover here:
 * - Import correctness; use media-import tests for that.
 * - Detailed trim/move behavior; use dedicated timeline trim/move specs.
 * - Premium or in-development clip actions.
 */
