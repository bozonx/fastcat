import { test, expect, waitForEditorReady } from '../fixtures/workspace';
import { addMarkers, markerIds, removeMarker, updateMarker } from '../../utils/e2e/timeline';
import { waitForTimelineDoc } from '../../utils/e2e/otio';
import { secondsToTicks } from '~/utils/time';

test.describe('Web timeline markers', () => {
  test('creates, lists, filters, updates, removes and reloads markers', async ({
    page,
    e2eProject,
  }) => {
    // Marker positions are absolute timeline ticks; under the new timebase
    // (TICKS_PER_SECOND = 254_016_000_000) whole-second positions keep them
    // visibly separated on the ruler. audio-sine.wav is ~1s, so keep markers
    // inside the clip extent so they show in the markers table.
    const introTicks = secondsToTicks({ seconds: 0.3 });
    const chapterTicks = secondsToTicks({ seconds: 0.6 });
    const chapterDurationTicks = secondsToTicks({ seconds: 0.2 });

    const [introId, chapterId] = await addMarkers(page, [
      {
        timeTicks: introTicks,
        text: 'Intro marker',
        color: '#d0021b',
      },
      {
        timeTicks: chapterTicks,
        durationTicks: chapterDurationTicks,
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
            marker.durationTicks === chapterDurationTicks,
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
