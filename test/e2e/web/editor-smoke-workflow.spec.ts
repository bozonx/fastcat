/*
 * Basic desktop-web happy-path smoke workflow plan.
 *
 * Scope:
 * - This is the only long scenario. Keep detailed assertions in the dedicated
 *   specs and use this file to prove the main editor workflow remains connected.
 * - Use base functionality only: no premium or in-development feature flags.
 *
 * Scenario to implement:
 * - Open a prepared project through `e2eProject`.
 * - Import one short supported video fixture.
 * - Add it to the timeline.
 * - Play briefly, then pause.
 * - Trim one edge.
 * - Move the clip later on the same track.
 * - Reload the editor.
 * - Verify the clip is still present with the expected persisted timing.
 *
 * Do not add more long workflows here unless they cover a genuinely different
 * critical user path. Prefer short focused specs for regressions.
 */
