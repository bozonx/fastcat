import { test, expect } from '../fixtures/workspace';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import { seedProjectMedia } from '../../utils/e2e/file-manager';
import { addFileToTrack, trackIds } from '../../utils/e2e/timeline';
import { waitForTimelineDoc } from '../../utils/e2e/otio';
import { openMonitorMoreMenu, toggleMonitorPreviewEffects } from '../../utils/e2e/transport';

/**
 * E2E tests for Monitor UI controls and menu actions:
 * - Preview effects toggle
 * - Proxy usage toggle
 * - Monitor "More" dropdown options (Sync mode, preview resolution, stop-frame snapshot)
 */
test.describe('Web monitor UI controls & settings', () => {
  test.beforeEach(async ({ page, e2eProject }) => {
    const { uiPath } = await seedProjectMedia(
      page,
      e2eProject,
      MEDIA_FIXTURES.video.h264Mp4,
      'video',
    );
    const videoTrackId = (await trackIds(page))[0];
    await addFileToTrack(page, uiPath, videoTrackId);
    await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 1);
  });

  test('toggling monitor preview effects updates toggle button state', async ({ page }) => {
    const effectsBtn = page.getByTestId('monitor-preview-effects');
    await expect(effectsBtn).toBeVisible();

    // Toggle off
    await toggleMonitorPreviewEffects(page);
    // Button state changes
    await expect(effectsBtn).toHaveAttribute('data-state', 'off');

    // Toggle on again
    await toggleMonitorPreviewEffects(page);
    await expect(effectsBtn).toHaveAttribute('data-state', 'on');
  });

  test('toggling monitor proxy usage updates proxy button state', async ({ page }) => {
    const proxyBtn = page.getByTestId('monitor-proxy-toggle');
    await expect(proxyBtn).toBeVisible();

    const initialState = await proxyBtn.getAttribute('data-state');
    await proxyBtn.click();

    const nextState = await proxyBtn.getAttribute('data-state');
    expect(nextState).not.toBe(initialState);
  });

  test('opening monitor more menu displays sync mode and snapshot items', async ({ page }) => {
    await openMonitorMoreMenu(page);

    // Context / More menu items should render options like Monitor sync and Snapshot
    const menuContent = page.locator('[role="menu"], .u-dropdown-menu');
    await expect(menuContent).toBeVisible();
    await expect(menuContent).toContainText('Monitor sync');
    await expect(menuContent).toContainText('Snapshot');
  });

  test('triggering snapshot from more menu executes without errors', async ({ page }) => {
    await openMonitorMoreMenu(page);

    const snapshotOption = page.locator('[role="menuitem"], .u-dropdown-menu button').filter({
      hasText: 'Snapshot',
    });
    await expect(snapshotOption).toBeVisible();

    // Triggering snapshot action shouldn't crash the editor
    await snapshotOption.click();
    await expect(page.getByTestId('monitor-seekbar')).toBeVisible();
  });
});
