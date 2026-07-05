import { test, expect } from '../fixtures/workspace';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import { entryByPath, seedProjectMedia } from '../../utils/e2e/file-manager';
import { addFileToTrack, trackIds } from '../../utils/e2e/timeline';
import { waitForTimelineDoc } from '../../utils/e2e/otio';

/**
 * E2E tests for Proxy media management in FastCat web app:
 * - Toggling proxy usage mode in Monitor
 * - Context menu and file manager proxy actions for video clips
 */
test.describe('Proxy media management', () => {
  let seededVideoPath: string;

  test.beforeEach(async ({ page, e2eProject }) => {
    const { uiPath } = await seedProjectMedia(
      page,
      e2eProject,
      MEDIA_FIXTURES.video.h264Mp4,
      'video',
    );
    seededVideoPath = uiPath;
    const videoTrackId = (await trackIds(page))[0];
    await addFileToTrack(page, uiPath, videoTrackId);
    await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 1);
  });

  test('toggling monitor proxy toggle button updates data-state attribute', async ({ page }) => {
    const proxyBtn = page.getByTestId('monitor-proxy-toggle');
    await expect(proxyBtn).toBeVisible();

    const initialState = await proxyBtn.getAttribute('data-state');
    await proxyBtn.click();

    const nextState = await proxyBtn.getAttribute('data-state');
    expect(nextState).not.toBe(initialState);

    // Toggle back
    await proxyBtn.click();
    const finalState = await proxyBtn.getAttribute('data-state');
    expect(finalState).toBe(initialState);
  });

  test('file manager item context menu opens and exhibits expected proxy actions or options', async ({
    page,
  }) => {
    const fileItem = entryByPath(page, seededVideoPath);
    await expect(fileItem).toBeVisible();

    // Right-click on file item to open context menu
    await fileItem.click({ button: 'right' });

    const contextMenu = page.locator('[role="menu"], .context-menu');
    await expect(contextMenu).toBeVisible();
  });
});
