import { test, expect, waitForEditorReady } from '../fixtures/workspace';
import { addMarkers, markerIds, removeMarker, updateMarker } from '../../utils/e2e/timeline';
import { waitForTimelineDoc } from '../../utils/e2e/otio';

test.describe('Web timeline markers', () => {
  test('creates, lists, filters, updates, removes and reloads markers', async ({
    page,
    e2eProject,
  }) => {
    const [introId, chapterId] = await addMarkers(page, [
      {
        timeTicks: 1_000_000,
        text: 'Intro marker',
        color: '#d0021b',
      },
      {
        timeTicks: 2_000_000,
        durationTicks: 3_000_000,
        text: 'Chapter zone',
        color: '#4a90e2',
      },
    ]);
    expect(introId).toBeDefined();
    expect(chapterId).toBeDefined();

    await waitForTimelineDoc(
      page,
      e2eProject,
      (doc) =>
        doc.markers.length === 2 &&
        doc.markers.some((marker) => marker.id === introId! && marker.text === 'Intro marker') &&
        doc.markers.some(
          (marker) =>
            marker.id === chapterId! &&
            marker.text === 'Chapter zone' &&
            marker.durationTicks === 3_000_000,
        ),
    );

    await page.goto(`/editor/${e2eProject.encodedName}`);
    await waitForEditorReady(page);
    await page.locator('[data-tab-id="markers"]').click();
    await expect(page.locator('tbody tr')).toHaveCount(2);
    await expect(page.getByText('Intro marker')).toBeVisible();
    await expect(page.getByText('Chapter zone')).toBeVisible();

    await page.locator('.marker-color-filter button').first().click();
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.getByText('Intro marker')).toBeHidden();
    await expect(page.getByText('Chapter zone')).toBeVisible();

    await page.getByText('Chapter zone').click();

    await updateMarker(page, {
      markerId: chapterId!,
      patch: { text: 'Chapter renamed' },
    });
    await removeMarker(page, introId!);

    await waitForTimelineDoc(
      page,
      e2eProject,
      (doc) =>
        doc.markers.length === 1 &&
        doc.markers[0]?.id === chapterId! &&
        doc.markers[0]?.text === 'Chapter renamed',
    );

    await page.goto(`/editor/${e2eProject.encodedName}`);
    await waitForEditorReady(page);
    await page.locator('[data-tab-id="markers"]').click();

    await expect.poll(async () => await markerIds(page)).toEqual([chapterId]);
    await expect(page.getByText('Chapter renamed')).toBeVisible();
    await expect(page.getByText('Intro marker')).toBeHidden();
  });
});
