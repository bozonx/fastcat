interface QueuedFileAccessInput<T> {
  key: string;
  task: () => Promise<T>;
}

const fileAccessQueues = new Map<string, Promise<void>>();

export async function runQueuedFileAccess<T>(input: QueuedFileAccessInput<T>): Promise<T> {
  const release = await acquireQueuedFileAccess(input.key);

  try {
    return await input.task();
  } finally {
    release();
  }
}

export async function acquireQueuedFileAccess(key: string): Promise<() => void> {
  const previous = fileAccessQueues.get(key) ?? Promise.resolve();

  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });

  const queued = previous
    .catch(() => {
      // Keep the queue alive after a failed operation.
    })
    .then(() => current);

  fileAccessQueues.set(key, queued);

  await previous.catch(() => {
    // The next operation should still run after a previous failure.
  });

  return () => {
    release();
    if (fileAccessQueues.get(key) === queued) {
      fileAccessQueues.delete(key);
    }
  };
}

export function getQueuedFileAccessSize(): number {
  return fileAccessQueues.size;
}
