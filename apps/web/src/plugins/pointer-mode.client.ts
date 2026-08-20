import { defineNuxtPlugin } from 'nuxt/app';

/**
 * Tracks the input modality currently in use and reflects it on the <html>
 * element so the desktop layout can adapt to touch/stylus without depending on
 * the route-based mobile flag (`/m/*`).
 *
 * - `data-pointer` holds the last used pointer type ('mouse' | 'touch' | 'pen').
 * - `.coarse-pointer` is present while the user drives the app with a finger or
 *   stylus. CSS uses it to surface hover-only affordances (e.g. clip trim
 *   grips) that a coarse pointer can never reveal on its own.
 *
 * Mouse always wins back: the moment a mouse pointer event arrives the class is
 * removed, so a touchscreen laptop driven with a mouse behaves as a normal
 * desktop.
 */
export default defineNuxtPlugin(() => {
  if (import.meta.server) return;

  const root = document.documentElement;

  function applyPointerType(pointerType: string) {
    // Keyboard-synthesised pointer events report an empty pointerType.
    if (!pointerType) return;
    if (root.dataset.pointer === pointerType) return;
    root.dataset.pointer = pointerType;
    root.classList.toggle('coarse-pointer', pointerType === 'touch' || pointerType === 'pen');
  }

  // Seed from the primary pointer so the very first paint already matches the
  // device (a tablet boots straight into coarse-pointer styling).
  const primaryCoarse =
    typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  applyPointerType(primaryCoarse ? 'touch' : 'mouse');

  window.addEventListener('pointerdown', (event) => applyPointerType(event.pointerType), {
    capture: true,
    passive: true,
  });
});
