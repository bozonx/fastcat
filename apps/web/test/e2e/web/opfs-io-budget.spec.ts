import { test, expect } from '@playwright/test';

interface IoBudgetE2EResult {
  capacity: number;
  completed: number;
  peak: number;
  violations: number;
  crossOriginIsolated: boolean;
  filesVerified: boolean;
}

test.describe('Web OPFS I/O budget', () => {
  test('coordinates main-thread and worker OPFS writes through the shared budget', async ({
    page,
  }) => {
    await page.goto('/');

    const result = await page.evaluate(async (): Promise<IoBudgetE2EResult> => {
      const TEST_DIR = 'fastcat-io-budget-e2e';
      const MAIN_TASKS = 4;
      const WORKERS = 2;
      const WORKER_TASKS = 4;
      const INTERACTIVE_AVAILABLE_SLOT = 0;
      const BROWSER_INTERACTIVE_CAPACITY = 2;

      function recordPeak(view: Int32Array, value: number): void {
        while (true) {
          const current = Atomics.load(view, 1);
          if (value <= current) return;
          if (Atomics.compareExchange(view, 1, current, value) === current) return;
        }
      }

      function delay(ms: number): Promise<void> {
        return new Promise((resolve) => window.setTimeout(resolve, ms));
      }

      async function acquireBudgetSlot(budgetView: Int32Array): Promise<() => void> {
        while (true) {
          const current = Atomics.load(budgetView, INTERACTIVE_AVAILABLE_SLOT);
          if (
            current > 0 &&
            Atomics.compareExchange(
              budgetView,
              INTERACTIVE_AVAILABLE_SLOT,
              current,
              current - 1,
            ) === current
          ) {
            let released = false;
            return () => {
              if (released) return;
              released = true;
              Atomics.add(budgetView, INTERACTIVE_AVAILABLE_SLOT, 1);
              Atomics.notify(budgetView, INTERACTIVE_AVAILABLE_SLOT, 1);
            };
          }

          if (typeof Atomics.waitAsync === 'function') {
            const wait = Atomics.waitAsync(budgetView, INTERACTIVE_AVAILABLE_SLOT, 0, 1000);
            if (wait.async) await wait.value;
          } else {
            await delay(5);
          }
        }
      }

      async function writeTestFile(label: string, index: number, content: string): Promise<void> {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle(TEST_DIR, { create: true });
        const handle = await dir.getFileHandle(`${label}-${index}.txt`, { create: true });
        const writable = await handle.createWritable();
        await writable.write(content);
        await delay(25);
        await writable.close();
      }

      function createWorker(): Worker {
        const source = `
          const TEST_DIR = ${JSON.stringify(TEST_DIR)};
          const INTERACTIVE_AVAILABLE_SLOT = ${INTERACTIVE_AVAILABLE_SLOT};

          function delay(ms) {
            return new Promise((resolve) => setTimeout(resolve, ms));
          }

          function recordPeak(view, value) {
            while (true) {
              const current = Atomics.load(view, 1);
              if (value <= current) return;
              if (Atomics.compareExchange(view, 1, current, value) === current) return;
            }
          }

          async function acquireBudgetSlot(budgetView) {
            while (true) {
              const current = Atomics.load(budgetView, INTERACTIVE_AVAILABLE_SLOT);
              if (
                current > 0 &&
                Atomics.compareExchange(
                  budgetView,
                  INTERACTIVE_AVAILABLE_SLOT,
                  current,
                  current - 1
                ) === current
              ) {
                let released = false;
                return () => {
                  if (released) return;
                  released = true;
                  Atomics.add(budgetView, INTERACTIVE_AVAILABLE_SLOT, 1);
                  Atomics.notify(budgetView, INTERACTIVE_AVAILABLE_SLOT, 1);
                };
              }

              if (typeof Atomics.waitAsync === 'function') {
                const wait = Atomics.waitAsync(budgetView, INTERACTIVE_AVAILABLE_SLOT, 0, 1000);
                if (wait.async) await wait.value;
              } else {
                await delay(5);
              }
            }
          }

          async function writeTestFile(label, index, content) {
            const root = await navigator.storage.getDirectory();
            const dir = await root.getDirectoryHandle(TEST_DIR, { create: true });
            const handle = await dir.getFileHandle(label + '-' + index + '.txt', { create: true });
            const writable = await handle.createWritable();
            await writable.write(content);
            await delay(25);
            await writable.close();
          }

          self.onmessage = async (event) => {
            const { budgetBuffer, counterBuffer, label, tasks, capacity } = event.data;
            const budgetView = new Int32Array(budgetBuffer);
            const counterView = new Int32Array(counterBuffer);

            try {
              await Promise.all(Array.from({ length: tasks }, async (_, index) => {
                const release = await acquireBudgetSlot(budgetView);
                const inFlight = Atomics.add(counterView, 0, 1) + 1;
                recordPeak(counterView, inFlight);
                if (inFlight > capacity) Atomics.add(counterView, 2, 1);

                try {
                  await writeTestFile(label, index, label + ':' + index);
                } finally {
                  Atomics.sub(counterView, 0, 1);
                  release();
                }
              }));
              self.postMessage({ type: 'done' });
            } catch (error) {
              self.postMessage({
                type: 'error',
                message: error instanceof Error ? error.message : String(error),
              });
            }
          };
        `;
        const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
        const worker = new Worker(url);
        URL.revokeObjectURL(url);
        return worker;
      }

      async function verifyFiles(): Promise<boolean> {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle(TEST_DIR);

        for (let index = 0; index < MAIN_TASKS; index += 1) {
          const file = await (await dir.getFileHandle(`main-${index}.txt`)).getFile();
          if ((await file.text()) !== `main:${index}`) return false;
        }

        for (let workerIndex = 0; workerIndex < WORKERS; workerIndex += 1) {
          for (let taskIndex = 0; taskIndex < WORKER_TASKS; taskIndex += 1) {
            const file = await (
              await dir.getFileHandle(`worker-${workerIndex}-${taskIndex}.txt`)
            ).getFile();
            if ((await file.text()) !== `worker-${workerIndex}:${taskIndex}`) return false;
          }
        }

        return true;
      }

      if (!window.crossOriginIsolated) {
        return {
          capacity: BROWSER_INTERACTIVE_CAPACITY,
          completed: 0,
          peak: 0,
          violations: 1,
          crossOriginIsolated: false,
          filesVerified: false,
        };
      }

      const root = await navigator.storage.getDirectory();
      await root.removeEntry(TEST_DIR, { recursive: true }).catch(() => {});

      const budgetBuffer = new SharedArrayBuffer(8 * Int32Array.BYTES_PER_ELEMENT);
      const budgetView = new Int32Array(budgetBuffer);
      Atomics.store(budgetView, INTERACTIVE_AVAILABLE_SLOT, BROWSER_INTERACTIVE_CAPACITY);

      const counterBuffer = new SharedArrayBuffer(4 * Int32Array.BYTES_PER_ELEMENT);
      const counters = new Int32Array(counterBuffer);

      const workerRuns = Array.from({ length: WORKERS }, (_, workerIndex) => {
        const worker = createWorker();
        return new Promise<void>((resolve, reject) => {
          worker.onmessage = (event: MessageEvent) => {
            if (event.data?.type === 'done') {
              worker.terminate();
              resolve();
              return;
            }
            worker.terminate();
            reject(new Error(event.data?.message ?? 'worker failed'));
          };
          worker.onerror = (event) => {
            worker.terminate();
            reject(new Error(event.message));
          };
          worker.postMessage({
            budgetBuffer,
            counterBuffer,
            label: `worker-${workerIndex}`,
            tasks: WORKER_TASKS,
            capacity: BROWSER_INTERACTIVE_CAPACITY,
          });
        });
      });

      const mainRuns = Array.from({ length: MAIN_TASKS }, async (_, index) => {
        const release = await acquireBudgetSlot(budgetView);
        const inFlight = Atomics.add(counters, 0, 1) + 1;
        recordPeak(counters, inFlight);
        if (inFlight > BROWSER_INTERACTIVE_CAPACITY) Atomics.add(counters, 2, 1);

        try {
          await writeTestFile('main', index, `main:${index}`);
        } finally {
          Atomics.sub(counters, 0, 1);
          release();
        }
      });

      await Promise.all([...workerRuns, ...mainRuns]);

      const completed = MAIN_TASKS + WORKERS * WORKER_TASKS;
      const filesVerified = await verifyFiles();
      await root.removeEntry(TEST_DIR, { recursive: true }).catch(() => {});

      return {
        capacity: BROWSER_INTERACTIVE_CAPACITY,
        completed,
        peak: Atomics.load(counters, 1),
        violations: Atomics.load(counters, 2),
        crossOriginIsolated: window.crossOriginIsolated,
        filesVerified,
      };
    });

    expect(result.crossOriginIsolated).toBe(true);
    expect(result.completed).toBe(12);
    expect(result.filesVerified).toBe(true);
    expect(result.violations).toBe(0);
    expect(result.peak).toBe(result.capacity);
  });
});
