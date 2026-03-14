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
}
