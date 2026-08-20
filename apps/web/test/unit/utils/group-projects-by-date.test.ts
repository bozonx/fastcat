/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { groupProjectsByDate } from '~/utils/project/groupProjectsByDate';

interface P {
  name: string;
  updatedAt: string | number | null;
}

// Fixed reference: Wednesday, 2026-07-08 15:00 local time.
const NOW = new Date(2026, 6, 8, 15, 0, 0);

function group(projects: P[]) {
  return groupProjectsByDate(projects, (p) => p.updatedAt, NOW);
}

describe('groupProjectsByDate', () => {
  it('places same-day projects in the today bucket', () => {
    const groups = group([{ name: 'a', updatedAt: new Date(2026, 6, 8, 9, 0).toISOString() }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('today');
    expect(groups[0].projects.map((p) => p.name)).toEqual(['a']);
  });

  it('separates yesterday from today', () => {
    const groups = group([
      { name: 'today', updatedAt: new Date(2026, 6, 8, 1, 0).toISOString() },
      { name: 'yesterday', updatedAt: new Date(2026, 6, 7, 23, 0).toISOString() },
    ]);
    expect(groups.map((g) => g.kind)).toEqual(['today', 'yesterday']);
  });

  it('buckets earlier-this-week days into thisWeek (excluding today/yesterday)', () => {
    // Week starts Monday 2026-07-06. Monday counts as thisWeek, not yesterday.
    const groups = group([{ name: 'mon', updatedAt: new Date(2026, 6, 6, 10, 0).toISOString() }]);
    expect(groups[0].kind).toBe('thisWeek');
  });

  it('buckets the previous calendar week into lastWeek', () => {
    const groups = group([{ name: 'x', updatedAt: new Date(2026, 6, 2, 10, 0).toISOString() }]);
    expect(groups[0].kind).toBe('lastWeek');
  });

  it('buckets earlier-this-month into thisMonth', () => {
    // Reference Monday 2026-07-20: last week starts 2026-07-13, so a 2026-07-05
    // project is same-month but older than last week → thisMonth.
    const later = new Date(2026, 6, 20, 15, 0, 0);
    const groups = groupProjectsByDate(
      [{ name: 'x', updatedAt: new Date(2026, 6, 5, 10, 0).toISOString() }],
      (p) => p.updatedAt,
      later,
    );
    expect(groups[0].kind).toBe('thisMonth');
  });

  it('buckets older projects by calendar month, newest bucket first', () => {
    const groups = group([
      { name: 'june', updatedAt: new Date(2026, 5, 15).toISOString() },
      { name: 'may', updatedAt: new Date(2026, 4, 3).toISOString() },
      { name: 'june2', updatedAt: new Date(2026, 5, 2).toISOString() },
    ]);
    expect(groups.map((g) => g.id)).toEqual(['month-2026-5', 'month-2026-4']);
    expect(groups[0].kind).toBe('month');
    expect(groups[0].year).toBe(2026);
    expect(groups[0].month).toBe(5);
    expect(groups[0].projects.map((p) => p.name)).toEqual(['june', 'june2']);
  });

  it('collects projects without a valid date into the unknown bucket', () => {
    const groups = group([
      { name: 'nulldate', updatedAt: null },
      { name: 'garbage', updatedAt: 'not-a-date' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('unknown');
    expect(groups[0].projects).toHaveLength(2);
  });

  it('orders buckets by first appearance of a member (caller pre-sorts projects)', () => {
    const groups = group([
      { name: 'old', updatedAt: new Date(2026, 3, 1).toISOString() },
      { name: 'today', updatedAt: new Date(2026, 6, 8, 8, 0).toISOString() },
      { name: 'lastweek', updatedAt: new Date(2026, 6, 2).toISOString() },
      { name: 'unknown', updatedAt: null },
    ]);
    expect(groups.map((g) => g.kind)).toEqual(['month', 'today', 'lastWeek', 'unknown']);
  });
});
