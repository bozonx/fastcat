import { test, expect, waitForEditorReady } from '../fixtures/workspace';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import { seedProjectMedia } from '../../utils/e2e/file-manager';
import {
  addFileToTrack,
  clipIds,
  deleteSelectedItems,
  getSelectedItemIds,
  selectClip,
  trackIds,
} from '../../utils/e2e/timeline';
import { waitForTimelineDoc } from '../../utils/e2e/otio';

/**
 * Timeline multi-select and bulk delete. Selection is exercised through real
 * Ctrl+click UI interactions; deletion uses the same command path as the app.
 */
test.describe('Web timeline multi-select', () => {
  test('ctrl-click selects two clips and bulk delete removes them', async ({
    page,
    e2eProject,
  }) => {
    const { uiPath } = await seedProjectMedia(
      page,
      e2eProject,
      MEDIA_FIXTURES.video.h264Mp4,
      'video',
    );
    const trackIdsList = await trackIds(page);
    await addFileToTrack(page, uiPath, trackIdsList[0]);
    await addFileToTrack(page, uiPath, trackIdsList[1]);
    await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 2);

    const ids = await clipIds(page);
    expect(ids.length).toBe(2);
    const [clipA, clipB] = ids;

    await selectClip(page, clipA);
    await page.keyboard.down('Control');
    await selectClip(page, clipB);
    await page.keyboard.up('Control');

    const selected = await getSelectedItemIds(page);
    expect(selected).toContain(clipA);
    expect(selected).toContain(clipB);

    await deleteSelectedItems(page);
    await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 0);
    await expect.poll(async () => (await clipIds(page)).length).toBe(0);

    // Reload should show the empty timeline.
    await page.goto(`/editor/${e2eProject.encodedName}`);
    await waitForEditorReady(page);
    await expect.poll(async () => (await clipIds(page)).length).toBe(0);
  });
});
