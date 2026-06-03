/**
 * Base options shared across single and batch timeline command application.
 * Kept in a standalone file so both the store and application layers can
 * import it without creating circular dependencies.
 */
export interface TimelineApplyOptions {
  saveMode?: 'debounced' | 'immediate' | 'none';
  skipHistory?: boolean;
  labelKey?: string;
}

/**
 * Extended options available for single-command apply (not batch),
 * because history debouncing only makes sense per-command.
 */
export interface TimelineApplyWithHistoryOptions extends TimelineApplyOptions {
  historyMode?: 'immediate' | 'debounced';
  historyDebounceMs?: number;
}
