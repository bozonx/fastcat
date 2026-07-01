/*
 * Basic desktop-web media import coverage plan.
 *
 * Scope:
 * - Use `e2eProject` and local fixtures from `test/fixtures/media`.
 * - Verify user-visible import behavior, not every codec/container. Detailed
 *   format ingest coverage stays in `media-format-import.spec.ts`.
 * - Cover only base flows that are available without premium or in-development
 *   feature flags.
 *
 * Scenarios to implement:
 * - Import one supported video fixture into an empty project.
 * - Import one supported audio fixture into an empty project.
 * - Import one supported image fixture into an empty project.
 * - Verify imported files appear in the project file manager after reload.
 * - Verify unsupported or web-rejected formats show a clear error without
 *   corrupting the project state.
 *
 * Do not cover here:
 * - Adding imported media to the timeline.
 * - Playback, trimming, moving, or export.
 * - Native-only import/conversion fallbacks.
 */
