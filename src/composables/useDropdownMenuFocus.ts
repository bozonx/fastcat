/**
 * Content props for `UDropdownMenu` / `UContextMenu` that stop Reka UI from
 * returning focus to the trigger button when the menu closes.
 *
 * On close Reka's FocusScope restores focus to the previously focused element
 * (the trigger) unless its `closeAutoFocus` event is default-prevented — see
 * reka-ui `Menu/MenuContentImpl` (maps `closeAutoFocus` → FocusScope
 * `onUnmountAutoFocus`) and `FocusScope` (`if (!unmountEvent.defaultPrevented)
 * focus(previouslyFocusedElement ?? document.body)`).
 *
 * Leaving focus parked on the trigger button breaks global hotkeys — notably
 * Space / play-pause — because the focused <button> captures the key (native
 * activation) and shifts the active focus-zone away from the monitor/timeline.
 * Preventing the restore lets focus fall to <body>, so hotkeys keep working.
 *
 * This is a plain DOM event, so it behaves identically in WebKitGTK (Tauri) and
 * Chromium-based web builds — no reliance on `:focus-visible` heuristics.
 *
 * Bind via the `:content` prop: `<UDropdownMenu :content="dropdownNoReturnFocus" />`.
 */
export const dropdownNoReturnFocus = {
  onCloseAutoFocus: (event: Event) => event.preventDefault(),
} as const;
