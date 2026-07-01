/*
 * Basic desktop-web file manager coverage plan.
 *
 * Scope:
 * - Use `e2eProject` so every test starts with an open project and an isolated
 *   OPFS workspace.
 * - Cover only base functionality visible when premium and in-development
 *   feature flags are disabled.
 * - Prefer short scenarios that verify one user outcome each.
 *
 * Scenarios to implement:
 * - Create a folder in the current project and verify it appears after reload.
 * - Rename a project file or folder and verify the OPFS entry moved.
 * - Move a media file into a folder and verify the UI and OPFS tree agree.
 * - Delete a file and verify it is removed from the UI and OPFS.
 * - Select multiple files and verify bulk selection state and clear-selection.
 * - Switch grid/list view if both modes are available in base mode.
 *
 * Do not cover here:
 * - Remote file browser and BloggerDog flows.
 * - Conversion, transcription, captions, proxy generation, background tasks, or
 *   common-root behavior gated by in-development or premium flags.
 * - Timeline drag/drop; that belongs in timeline add-clip scenarios.
 */
