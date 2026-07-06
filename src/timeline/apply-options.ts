/**
 * Base options shared across single and batch timeline command application.
 * Kept in a standalone file so both the store and application layers can
 * import it without creating circular dependencies.
 */
export interface TimelineApplyOptions {
  saveMode?: 'debounced' | 'immediate' | 'none';
  skipHistory?: boolean;
  labelKey?: string;
  historyMode?: 'immediate' | 'debounced';
  historyDebounceMs?: number;
}

/**
 * Extended options available for single-command apply.
 */
export interface TimelineApplyWithHistoryOptions extends TimelineApplyOptions {}
