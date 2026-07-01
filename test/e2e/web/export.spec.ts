/*
 * Basic desktop-web export coverage plan.
 *
 * Scope:
 * - Start from `e2eProject`.
 * - Prepare a small timeline with supported media and base settings.
 * - Use the shortest reliable export preset or test-only export path available
 *   in the UI.
 *
 * Scenarios to implement:
 * - Open the export panel for a prepared timeline.
 * - Change a base export setting and verify it is reflected in the form state.
 * - Run a short export and verify an output file appears in the project export
 *   directory.
 * - Verify export progress reaches a completed state without uncaught errors.
 *
 * Do not cover here:
 * - Premium presets, hardware/native export, conversion-only paths, or advanced
 *   codec compatibility matrices.
 * - Pixel parity; use parity tests for frame correctness.
 */
