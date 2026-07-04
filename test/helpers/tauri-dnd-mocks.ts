import { vi } from 'vitest';

export interface MockTauriDropEvent {
  payload: {
    type: 'enter' | 'over' | 'drop' | 'leave';
    paths?: string[];
    position?: { x: number; y: number };
  };
}

export function createTauriDndMocks() {
  const onDragDropEventMock = vi.fn();
  const invokeMock = vi.fn(() => Promise.resolve());
  const readFileMock = vi.fn();
  const statMock = vi.fn();

  return {
    onDragDropEventMock,
    invokeMock,
    readFileMock,
    statMock,
    setupWebviewMock() {
      onDragDropEventMock.mockReset();
      onDragDropEventMock.mockResolvedValue(vi.fn());
    },
    triggerDropEvent(
      handler: (event: MockTauriDropEvent) => void | Promise<void>,
      event: MockTauriDropEvent,
    ) {
      return handler(event);
    },
  };
}
