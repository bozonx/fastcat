import { test as base, expect, type Page } from '@playwright/test';
import { removeOpfsEntry } from '../../utils/e2e/virtual-fs';

export interface E2eWorkspace {
  name: string;
}

interface WorkspaceFixtures {
  e2eWorkspace: E2eWorkspace;
}

function createWorkspaceName(testTitle: string, workerIndex: number, retry: number): string {
  const safeTitle = testTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  const random = Math.random().toString(36).slice(2, 8);

  return `e2e-${workerIndex}-${retry}-${safeTitle}-${random}`;
}

async function mockWorkspacePicker(page: Page, workspaceName: string): Promise<void> {
  await page.addInitScript((name) => {
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => {
        const root = await navigator.storage.getDirectory();
        const handle = await root.getDirectoryHandle(name, { create: true });
        const permission = async () => 'granted' as PermissionState;

        Object.defineProperties(handle, {
          queryPermission: {
            configurable: true,
            value: permission,
          },
          requestPermission: {
            configurable: true,
            value: permission,
          },
        });

        return handle;
      },
    });
  }, workspaceName);
}

export const test = base.extend<WorkspaceFixtures>({
  e2eWorkspace: async ({ page }, use, testInfo) => {
    const name = createWorkspaceName(testInfo.title, testInfo.workerIndex, testInfo.retry);
    await mockWorkspacePicker(page, name);

    await use({ name });

    if (!page.isClosed()) {
      try {
        await removeOpfsEntry(page, name);
      } catch {
        // The page can be on an error document after a failed test; cleanup is best-effort.
      }
    }
  },
});

export { expect };
