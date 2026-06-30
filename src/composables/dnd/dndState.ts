/**
 * Reactive global state for the active internal pointer-drag. There is at most
 * one active internal drag at a time, so this is a module-level singleton
 * (same pattern as `useDraggedFile`). The visual layer reads it; the engine and
 * drop zones mutate it through the exported setters.
 */
import { readonly, ref } from 'vue';
import type { DndOperation, DndPayload, DndPointer } from './dndTypes';

const active = ref(false);
const payload = ref<DndPayload | null>(null);
const pointer = ref<DndPointer | null>(null);
const operation = ref<DndOperation>('none');
const activeZoneId = ref<string | null>(null);

export function beginDndState(initialPayload: DndPayload, initialPointer: DndPointer): void {
  active.value = true;
  payload.value = initialPayload;
  pointer.value = initialPointer;
  operation.value = 'none';
  activeZoneId.value = null;
}

export function updateDndPointer(next: DndPointer): void {
  pointer.value = next;
}

export function setDndOperation(next: DndOperation): void {
  operation.value = next;
}

export function setDndActiveZoneId(id: string | null): void {
  activeZoneId.value = id;
}

export function endDndState(): void {
  active.value = false;
  payload.value = null;
  pointer.value = null;
  operation.value = 'none';
  activeZoneId.value = null;
}

export function isDndActive(): boolean {
  return active.value;
}

export function getDndPayload(): DndPayload | null {
  return payload.value;
}

/** Readonly view for components (visual layer, highlight bindings). */
export function useDndState() {
  return {
    active: readonly(active),
    payload: readonly(payload),
    pointer: readonly(pointer),
    operation: readonly(operation),
    activeZoneId: readonly(activeZoneId),
  };
}
