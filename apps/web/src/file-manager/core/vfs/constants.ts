/**
 * Minimum file size at which cross-adapter file copies show progress and
 * register a cancellable background task. Below this threshold the copy
 * proceeds inline without UI feedback to avoid noise from quick operations.
 */
export const LARGE_FILE_PROGRESS_THRESHOLD_BYTES = 10 * 1024 * 1024;
