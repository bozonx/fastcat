/*
 * Basic desktop-web timeline move coverage plan.
 *
 * Scope:
 * - Start from `e2eProject`.
 * - Prepare a timeline with one or more clips using helpers, not by repeating
 *   import and add-clip UI flows in every test.
 * - Verify both UI placement and persisted OTIO timing/track data.
 *
 * Scenarios to implement:
 * - Move a clip later on the same track and verify its start time changes.
 * - Move a clip between compatible tracks and verify the target track changes.
 * - Move two selected clips together and verify their relative timing remains.
 * - Verify snap behavior for a basic adjacent clip move if snap is enabled by
 *   default in base mode.
 * - Reload the editor and verify moved clips persist.
 *
 * Do not cover here:
 * - Track creation under experimental flags.
 * - Transition creation, grouping edge cases, or advanced ripple modes until
 *   base move behavior is stable.
 */
