export const pressedKeyCodes = new Set<string>();

if (typeof window !== 'undefined') {
  window.addEventListener(
    'keydown',
    (e) => {
      pressedKeyCodes.add(e.code);
    },
    { capture: true },
  );

  window.addEventListener(
    'keyup',
    (e) => {
      pressedKeyCodes.delete(e.code);
    },
    { capture: true },
  );

  window.addEventListener('blur', () => {
    pressedKeyCodes.clear();
  });

  // 'blur' sometimes misses when the tab is hidden (e.g. OS-level switch while a
  // side-specific modifier is held); clearing here too prevents a stuck layer
  // key from being treated as permanently pressed. Mirrors the hold-timer
  // cleanup in useEditorHotkeys.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        pressedKeyCodes.clear();
      }
    });
  }
}
