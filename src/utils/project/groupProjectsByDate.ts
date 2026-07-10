/**
 * Groups projects into date buckets (Today / Yesterday / This week / Last week /
 * This month / older months), the same pattern used by Apple Photos & Google Photos.
 *
 * Pure & framework-agnostic so it can be shared between the mobile and desktop
 * project lists and unit-tested in isolation. Bucket ordering is newest-first.
 */

export type ProjectDateBucketKind =
  | 'today'
  | 'yesterday'
  | 'thisWeek'
  | 'lastWeek'
  | 'thisMonth'
  | 'month'
  | 'unknown';

export interface ProjectDateGroup<T> {
  /** Stable id, used as a `:key` and for i18n lookups. */
  id: string;
  kind: ProjectDateBucketKind;
  /** Populated only when `kind === 'month'` — the calendar month this bucket covers. */
  year?: number;
  /** 0-based month index (`Date#getMonth`), only for `kind === 'month'`. */
  month?: number;
  projects: T[];
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Start of the ISO week (Monday) containing `d`, at local midnight. */
function startOfWeekMonday(d: Date): Date {
  const day = d.getDay(); // 0 = Sunday … 6 = Saturday
  const daysSinceMonday = (day + 6) % 7;
  const start = startOfDay(d);
  start.setDate(start.getDate() - daysSinceMonday);
  return start;
}

function timeOf<T>(
  item: T,
  getDate: (item: T) => Date | number | string | null | undefined,
): number {
  const raw = getDate(item);
  if (raw == null) return NaN;
  const date = raw instanceof Date ? raw : new Date(raw);
  const t = date.getTime();
  return Number.isNaN(t) ? NaN : t;
}

/**
 * Buckets `projects` by their date, newest bucket first. Projects inside each
 * bucket keep the order they were passed in, so pre-sort by date descending.
 *
 * @param getDate  extracts the project's modification date (`updatedAt`).
 * @param now      reference "now" — injectable for deterministic tests.
 */
export function groupProjectsByDate<T>(
  projects: readonly T[],
  getDate: (item: T) => Date | number | string | null | undefined,
  now: Date = new Date(),
): ProjectDateGroup<T>[] {
  const startToday = startOfDay(now).getTime();
  const startYesterday = startToday - 24 * 60 * 60 * 1000;
  const startThisWeek = startOfWeekMonday(now).getTime();
  const startLastWeek = startThisWeek - 7 * 24 * 60 * 60 * 1000;
  const startThisMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  const groups: ProjectDateGroup<T>[] = [];
  // Keyed lookup so items collapse into the same bucket instance.
  const byId = new Map<string, ProjectDateGroup<T>>();

  const push = (group: Omit<ProjectDateGroup<T>, 'projects'>, item: T) => {
    let existing = byId.get(group.id);
    if (!existing) {
      existing = { ...group, projects: [] };
      byId.set(group.id, existing);
      groups.push(existing);
    }
    existing.projects.push(item);
  };

  for (const project of projects) {
    const t = timeOf(project, getDate);

    if (Number.isNaN(t)) {
      push({ id: 'unknown', kind: 'unknown' }, project);
    } else if (t >= startToday) {
      push({ id: 'today', kind: 'today' }, project);
    } else if (t >= startYesterday) {
      push({ id: 'yesterday', kind: 'yesterday' }, project);
    } else if (t >= startThisWeek) {
      push({ id: 'thisWeek', kind: 'thisWeek' }, project);
    } else if (t >= startLastWeek) {
      push({ id: 'lastWeek', kind: 'lastWeek' }, project);
    } else if (t >= startThisMonth) {
      push({ id: 'thisMonth', kind: 'thisMonth' }, project);
    } else {
      const d = new Date(t);
      const year = d.getFullYear();
      const month = d.getMonth();
      push({ id: `month-${year}-${month}`, kind: 'month', year, month }, project);
    }
  }

  return groups;
}
