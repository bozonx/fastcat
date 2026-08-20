export function getDevicePixelRatio(): number {
  return window.devicePixelRatio || 1;
}

export function dispatchWindowEvent(event: Event): void {
  window.dispatchEvent(event);
}

export function elementFromPoint(x: number, y: number): Element | null {
  return document.elementFromPoint(x, y);
}

export function getActiveElement(): Element | null {
  return document.activeElement;
}

export function querySelector<E extends Element = Element>(selector: string): E | null {
  return document.querySelector<E>(selector);
}

export function querySelectorAll<E extends Element = Element>(selector: string): NodeListOf<E> {
  return document.querySelectorAll<E>(selector);
}

export function elementsFromPoint(x: number, y: number): Element[] {
  return document.elementsFromPoint(x, y);
}

export function addDocumentEventListener<K extends keyof DocumentEventMap>(
  type: K,
  listener: (this: Document, ev: DocumentEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
): void {
  document.addEventListener(type, listener as EventListener, options);
}

export function removeDocumentEventListener<K extends keyof DocumentEventMap>(
  type: K,
  listener: (this: Document, ev: DocumentEventMap[K]) => void,
  options?: boolean | EventListenerOptions,
): void {
  document.removeEventListener(type, listener as EventListener, options);
}
